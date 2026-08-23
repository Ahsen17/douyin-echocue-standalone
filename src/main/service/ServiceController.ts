import type {
  DomainErrorV1,
  LiveSourceEvent,
  ServiceViewState,
  SourceComment,
} from '@echocue/contracts';
import {
  SidecarStartFailedError,
  type DouyinLiveSidecarManager,
  type DouyinLiveWsAdapter,
} from '../douyin/index.js';
import type { ServiceStateMachine } from './ServiceStateMachine.js';
import type { Logger } from '../telemetry/index.js';

const DEFAULT_GATE_TIMEOUT_MS = 15_000;

export class ServiceStartConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceStartConflictError';
  }
}

export interface ServiceGateSettings {
  roomReference: string;
  providerCredentialRef: string;
}

export interface ServiceGateChecks {
  getSettings(): Promise<ServiceGateSettings | null>;
  getCredential(credentialRef: string): Promise<string | null>;
  isAuditHealthy(): Promise<boolean>;
  hasPublishedPersona(): Promise<boolean>;
  hasPublishedSafetyPolicy(): Promise<boolean>;
  isRetrievalReady(): Promise<boolean>;
  /** Data volume has enough free space to start (DATA §8.2: ≥ 2 GiB). */
  isStorageReady(): Promise<boolean>;
}

export interface ServiceControllerOptions {
  stateMachine: ServiceStateMachine;
  sidecar: DouyinLiveSidecarManager;
  createAdapter: (roomReference: string) => DouyinLiveWsAdapter;
  checks: ServiceGateChecks;
  createLiveSession: (params: {
    roomReference: string;
    platformRoomId?: string;
  }) => Promise<unknown>;
  /** Dispatched for every COMMENT event while the service is RUNNING (M5-07). */
  onComment?: (comment: SourceComment) => void;
  /** Invoked with the concrete stop reason so in-flight work can be cancelled. */
  cleanupOnStop: (reason: StopReason) => void;
  gateTimeoutMs?: number;
  /** Optional file logger; start-flow failures are recorded here for diagnosis. */
  logger?: Logger;
  /**
   * Periodic data-volume monitor (RUNBOOK §5.3). Started once the service is
   * RUNNING and stopped on every stop path; the monitor's onCritical is the
   * caller's responsibility (it stops the service, M7-07).
   */
  storageMonitor?: { start(): void; stop(): void };
}

type Phase = 'idle' | 'gate' | 'running';
type StopReason = NonNullable<ServiceViewState['stopReason']>;
type RecoverableError = NonNullable<ServiceViewState['recoverableError']>;

function nowIso(): string {
  return new Date().toISOString();
}

function gateError(code: DomainErrorV1): RecoverableError {
  return { code, at: nowIso() };
}

export class ServiceController {
  private readonly stateMachine: ServiceStateMachine;
  private readonly sidecar: DouyinLiveSidecarManager;
  private readonly createAdapter: (roomReference: string) => DouyinLiveWsAdapter;
  private readonly checks: ServiceGateChecks;
  private readonly createLiveSession: ServiceControllerOptions['createLiveSession'];
  private readonly onComment: ((comment: SourceComment) => void) | undefined;
  private readonly cleanupOnStop: (reason: StopReason) => void;
  private readonly gateTimeoutMs: number;
  private readonly storageMonitor: { start(): void; stop(): void } | undefined;
  private readonly logger: Logger | undefined;

  private adapter: DouyinLiveWsAdapter | null = null;
  private phase: Phase = 'idle';
  private abortRequested = false;
  private stopPromise: Promise<void> | null = null;
  private gateResolve: ((event: LiveSourceEvent | 'TIMEOUT' | 'ABORTED') => void) | null = null;
  private gateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ServiceControllerOptions) {
    this.stateMachine = options.stateMachine;
    this.sidecar = options.sidecar;
    this.createAdapter = options.createAdapter;
    this.checks = options.checks;
    this.createLiveSession = options.createLiveSession;
    this.onComment = options.onComment;
    this.cleanupOnStop = options.cleanupOnStop;
    this.gateTimeoutMs = options.gateTimeoutMs ?? DEFAULT_GATE_TIMEOUT_MS;
    this.storageMonitor = options.storageMonitor;
    this.logger = options.logger;
  }

  getViewState(): ServiceViewState {
    return this.stateMachine.getViewState();
  }

  // True while a start flow is in progress (gate → RUNNING). The lifecycle only
  // leaves STOPPED at GATE_CONNECTING, so an import guard that checks lifecycle
  // alone cannot see the earlier gate phase; this closes the import-vs-start race.
  isStarting(): boolean {
    return this.phase !== 'idle';
  }

  async start(): Promise<ServiceViewState> {
    if (this.phase !== 'idle' || this.stateMachine.getViewState().lifecycle !== 'STOPPED') {
      throw new ServiceStartConflictError('service is already starting or running');
    }
    this.abortRequested = false;
    this.stopPromise = null;
    // mark the whole start flow as active so stop() can interrupt it at any await
    this.phase = 'gate';

    let gate: Awaited<ReturnType<ServiceController['runGate']>>;
    try {
      gate = await this.runGate();
    } catch (err) {
      // An unexpected gate throw must not strand the controller in the start
      // phase: isStarting() would then block retrieval imports forever.
      this.phase = 'idle';
      throw err;
    }
    if (this.abortRequested) return this.afterAbort();
    if ('error' in gate) {
      this.logger?.error('lifecycle', 'service start blocked by gate', gate.error.code);
      this.enterStopped('SOURCE_ERROR', gate.error);
      return this.stateMachine.getViewState();
    }

    try {
      await this.sidecar.start();
    } catch (err) {
      const code =
        err instanceof SidecarStartFailedError ? 'E_SIDECAR_START_FAILED' : 'E_SOURCE_UNAVAILABLE';
      this.logger?.error(
        'lifecycle',
        `douyinLive sidecar start failed: ${err instanceof Error ? err.message : String(err)}`,
        code,
      );
      this.enterStopped('SOURCE_ERROR', gateError(code));
      return this.stateMachine.getViewState();
    }
    if (this.abortRequested) return this.afterAbort();

    const adapter = this.createAdapter(gate.roomReference);
    this.adapter = adapter;
    adapter.onEvent((event) => this.handleLiveEvent(event));
    try {
      await adapter.connect();
    } catch {
      this.logger?.error('lifecycle', 'douyinLive WebSocket connect failed', 'E_SOURCE_UNAVAILABLE');
      await this.shutdownSource();
      this.enterStopped('SOURCE_ERROR', gateError('E_SOURCE_UNAVAILABLE'));
      return this.stateMachine.getViewState();
    }
    if (this.abortRequested) return this.afterAbort();

    this.stateMachine.transitionToLifecycle('GATE_CONNECTING');
    const first = await this.waitForFirstStatus();
    if (this.abortRequested) return this.afterAbort();
    if (first === 'TIMEOUT') {
      this.logger?.warn('lifecycle', 'waiting for live room status timed out', 'E_SOURCE_UNAVAILABLE');
      await this.shutdownSource();
      this.enterStopped('SOURCE_ERROR', gateError('E_SOURCE_UNAVAILABLE'));
      return this.stateMachine.getViewState();
    }
    // ABORTED is normally intercepted by the abortRequested check above; this
    // branch stays for type narrowing and as a defensive guard
    if (first === 'ABORTED') {
      return this.stateMachine.getViewState();
    }

    if (first.type === 'LIVE_ONLINE') {
      if (this.stateMachine.getViewState().lifecycle !== 'GATE_CONNECTING') {
        return this.stateMachine.getViewState();
      }
      try {
        await this.createLiveSession({
          roomReference: gate.roomReference,
          ...(first.platformRoomId !== undefined ? { platformRoomId: first.platformRoomId } : {}),
        });
      } catch {
        await this.shutdownSource();
        this.enterStopped('AUDIT_UNAVAILABLE');
        return this.stateMachine.getViewState();
      }
      if (this.abortRequested || this.stateMachine.getViewState().lifecycle !== 'GATE_CONNECTING') {
        await this.shutdownSource();
        return this.stateMachine.getViewState();
      }
      this.phase = 'running';
      this.stateMachine.transitionToLifecycle('RUNNING');
      this.storageMonitor?.start();
      this.logger?.info('lifecycle', 'service RUNNING');
    } else {
      const stopReason = first.type === 'LIVE_OFFLINE' ? 'ROOM_OFFLINE' : 'ROOM_ENDED';
      this.logger?.warn('lifecycle', `live room not online: ${first.type}`, stopReason);
      await this.shutdownSource();
      this.enterStopped(stopReason);
    }
    return this.stateMachine.getViewState();
  }

  /**
   * Stop the service with a specific reason (M5-07). Defaults to USER_STOP;
   * the reason is forwarded to cleanupOnStop so in-flight work is cancelled
   * with the matching TraceReasonCodeV1.
   */
  async stop(reason: StopReason = 'USER_STOP'): Promise<ServiceViewState> {
    this.abortRequested = true;
    if (this.phase === 'idle' && this.stopPromise === null) {
      return this.stateMachine.getViewState();
    }
    if (this.stopPromise === null) {
      this.stopPromise = this.performStop(reason);
    }
    await this.stopPromise;
    return this.stateMachine.getViewState();
  }

  private performStop(stopReason: StopReason): Promise<void> {
    return (async () => {
      this.storageMonitor?.stop();
      this.cleanupOnStop(stopReason);
      const abort = this.gateResolve;
      this.gateResolve = null;
      if (this.gateTimer !== null) {
        clearTimeout(this.gateTimer);
        this.gateTimer = null;
      }
      await this.shutdownSource();
      this.enterStopped(stopReason);
      if (abort !== null) abort('ABORTED');
    })();
  }

  private async afterAbort(): Promise<ServiceViewState> {
    await this.stopPromise;
    return this.stateMachine.getViewState();
  }

  private async runGate(): Promise<{ roomReference: string } | { error: RecoverableError }> {
    const settings = await this.checks.getSettings();
    if (settings === null) return { error: gateError('E_CONFIG_INVALID') };
    const credential = await this.checks.getCredential(settings.providerCredentialRef);
    if (credential === null) return { error: gateError('E_CONFIG_INVALID') };
    if (!(await this.checks.isAuditHealthy())) return { error: gateError('E_AUDIT_UNAVAILABLE') };
    if (!(await this.checks.hasPublishedPersona())) return { error: gateError('E_CONFIG_INVALID') };
    if (!(await this.checks.hasPublishedSafetyPolicy())) {
      return { error: gateError('E_SAFETY_POLICY_INVALID') };
    }
    if (!(await this.checks.isRetrievalReady())) return { error: gateError('E_QDRANT_UNAVAILABLE') };
    if (!(await this.checks.isStorageReady())) return { error: gateError('E_STORAGE_LOW') };
    return { roomReference: settings.roomReference };
  }

  private waitForFirstStatus(): Promise<LiveSourceEvent | 'TIMEOUT' | 'ABORTED'> {
    return new Promise((resolve) => {
      this.gateResolve = resolve;
      this.gateTimer = setTimeout(() => {
        this.gateResolve = null;
        this.gateTimer = null;
        resolve('TIMEOUT');
      }, this.gateTimeoutMs);
    });
  }

  private handleLiveEvent(event: LiveSourceEvent): void {
    if (this.phase === 'gate') {
      if (this.gateResolve !== null) {
        const resolve = this.gateResolve;
        this.gateResolve = null;
        if (this.gateTimer !== null) {
          clearTimeout(this.gateTimer);
          this.gateTimer = null;
        }
        resolve(event);
      }
      return;
    }
    if (this.phase === 'running') {
      if (event.type === 'LIVE_OFFLINE') void this.stopFromRunning('ROOM_OFFLINE');
      else if (event.type === 'LIVE_ENDED') void this.stopFromRunning('ROOM_ENDED');
      else if (event.type === 'SOURCE_ERROR') void this.stopFromRunning('SOURCE_ERROR');
      else if (event.type === 'COMMENT' && this.onComment !== undefined) {
        this.onComment(event.comment);
      }
    }
  }

  private async stopFromRunning(stopReason: StopReason): Promise<void> {
    if (this.phase !== 'running') return;
    this.abortRequested = true;
    this.stopPromise = this.performStop(stopReason);
    await this.stopPromise;
  }

  private async shutdownSource(): Promise<void> {
    this.adapter?.close();
    this.adapter = null;
    await this.sidecar.stop();
  }

  private enterStopped(stopReason: StopReason, recoverableError?: RecoverableError): void {
    this.phase = 'idle';
    if (this.stateMachine.getViewState().lifecycle === 'STOPPED') {
      if (recoverableError !== undefined) this.stateMachine.recordRecoverableError(recoverableError);
      return;
    }
    this.stateMachine.transitionToLifecycle('STOPPED', {
      stopReason,
      ...(recoverableError !== undefined ? { recoverableError } : {}),
    });
  }
}
