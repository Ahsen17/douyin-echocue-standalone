import { describe, expect, it } from 'vitest';
import type { LiveSourceEvent, ServiceLifecycle } from '@echocue/contracts';
import {
  ServiceController,
  ServiceStartConflictError,
  ServiceStateMachine,
  type ServiceGateChecks,
} from '../../../src/main/service/index.js';
import { SidecarStartFailedError } from '../../../src/main/douyin/index.js';

type Listener = (event: LiveSourceEvent) => void;

class FakeAdapter {
  private listeners = new Set<Listener>();
  isOpen = false;
  failConnect = false;
  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  async connect(): Promise<void> {
    if (this.failConnect) throw new Error('connection refused');
    this.isOpen = true;
  }
  close(): void {
    this.isOpen = false;
  }
  emit(event: LiveSourceEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

class FakeSidecar {
  started = false;
  stopCount = 0;
  failStart = false;
  async start(): Promise<void> {
    if (this.failStart) throw new SidecarStartFailedError('sidecar start failed');
    this.started = true;
  }
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.stopCount += 1;
  }
  async isHealthy(): Promise<boolean> {
    return this.started;
  }
  get pid(): number | null {
    return this.started ? 1 : null;
  }
}

function makeChecks(overrides: Partial<ServiceGateChecks> = {}): ServiceGateChecks {
  return {
    getSettings: async () => ({ roomReference: 'room-abc', providerCredentialRef: 'deepseek-01-key' }),
    getCredential: async () => 'sk-test',
    isAuditHealthy: async () => true,
    hasPublishedPersona: async () => true,
    hasPublishedSafetyPolicy: async () => true,
    isRetrievalReady: async () => true,
    ...overrides,
  };
}

interface Harness {
  controller: ServiceController;
  machine: ServiceStateMachine;
  adapter: FakeAdapter;
  sidecar: FakeSidecar;
  sessions: Array<{ roomReference: string; platformRoomId?: string }>;
  cleanupCount: () => number;
}

function makeHarness(checks: ServiceGateChecks, gateTimeoutMs = 2000): Harness {
  const machine = new ServiceStateMachine();
  const sidecar = new FakeSidecar();
  const adapter = new FakeAdapter();
  const sessions: Array<{ roomReference: string; platformRoomId?: string }> = [];
  let cleanupCount = 0;
  const controller = new ServiceController({
    stateMachine: machine,
    sidecar,
    createAdapter: () => adapter,
    checks,
    createLiveSession: async (params) => {
      sessions.push(params);
    },
    cleanupOnStop: () => {
      cleanupCount += 1;
    },
    gateTimeoutMs,
  });
  return {
    controller,
    machine,
    adapter,
    sidecar,
    sessions,
    cleanupCount: () => cleanupCount,
  };
}

async function waitForLifecycle(
  machine: ServiceStateMachine,
  lifecycle: ServiceLifecycle,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (machine.getViewState().lifecycle !== lifecycle) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${lifecycle}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sourceError(): LiveSourceEvent {
  return { type: 'SOURCE_ERROR', code: 'E_SOURCE_UNAVAILABLE', message: 'connection lost', receivedAt: '2026-08-22T12:00:00.000Z' };
}

function online(): LiveSourceEvent {
  return { type: 'LIVE_ONLINE', roomReference: 'room-abc', platformRoomId: '123456', receivedAt: '2026-08-22T12:00:00.000Z' };
}
function offline(): LiveSourceEvent {
  return { type: 'LIVE_OFFLINE', roomReference: 'room-abc', receivedAt: '2026-08-22T12:00:00.000Z' };
}
function ended(): LiveSourceEvent {
  return { type: 'LIVE_ENDED', roomReference: 'room-abc', receivedAt: '2026-08-22T12:00:00.000Z' };
}

describe('ServiceController gate', () => {
  it('rejects start with E_CONFIG_INVALID when settings are missing', async () => {
    const h = makeHarness(makeChecks({ getSettings: async () => null }));
    const state = await h.controller.start();
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.recoverableError?.code).toBe('E_CONFIG_INVALID');
    expect(h.sidecar.started).toBe(false);
  });

  it('rejects start with E_CONFIG_INVALID when the credential is missing', async () => {
    const h = makeHarness(makeChecks({ getCredential: async () => null }));
    const state = await h.controller.start();
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.recoverableError?.code).toBe('E_CONFIG_INVALID');
    expect(h.sidecar.started).toBe(false);
  });

  it('rejects start with E_AUDIT_UNAVAILABLE when audit is unhealthy', async () => {
    const h = makeHarness(makeChecks({ isAuditHealthy: async () => false }));
    const state = await h.controller.start();
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.recoverableError?.code).toBe('E_AUDIT_UNAVAILABLE');
    expect(h.sidecar.started).toBe(false);
  });

  it('rejects start with E_CONFIG_INVALID when no principal persona is published', async () => {
    const h = makeHarness(makeChecks({ hasPublishedPersona: async () => false }));
    const state = await h.controller.start();
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.recoverableError?.code).toBe('E_CONFIG_INVALID');
    expect(h.sidecar.started).toBe(false);
  });

  it('rejects start with E_SAFETY_POLICY_INVALID when no policy is published', async () => {
    const h = makeHarness(makeChecks({ hasPublishedSafetyPolicy: async () => false }));
    const state = await h.controller.start();
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.recoverableError?.code).toBe('E_SAFETY_POLICY_INVALID');
    expect(h.sidecar.started).toBe(false);
  });

  it('rejects start with E_QDRANT_UNAVAILABLE when retrieval is not ready', async () => {
    const h = makeHarness(makeChecks({ isRetrievalReady: async () => false }));
    const state = await h.controller.start();
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.recoverableError?.code).toBe('E_QDRANT_UNAVAILABLE');
    expect(h.sidecar.started).toBe(false);
  });
});

describe('ServiceController lifecycle', () => {
  it('reaches RUNNING after ROOM_ONLINE and creates a live session', async () => {
    const h = makeHarness(makeChecks());
    const startPromise = h.controller.start();
    await waitForLifecycle(h.machine, 'GATE_CONNECTING');
    h.adapter.emit(online());
    const state = await startPromise;
    expect(state.lifecycle).toBe('RUNNING');
    expect(state.activity).toBe('LISTENING');
    expect(h.sidecar.started).toBe(true);
    expect(h.sessions).toEqual([{ roomReference: 'room-abc', platformRoomId: '123456' }]);
  });

  it('stops with ROOM_OFFLINE when the room is offline at gate time', async () => {
    const h = makeHarness(makeChecks());
    const startPromise = h.controller.start();
    await waitForLifecycle(h.machine, 'GATE_CONNECTING');
    h.adapter.emit(offline());
    const state = await startPromise;
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.stopReason).toBe('ROOM_OFFLINE');
    expect(h.sidecar.started).toBe(false);
    expect(h.sidecar.stopCount).toBe(1);
    expect(h.adapter.isOpen).toBe(false);
  });

  it('stops with ROOM_ENDED when the room ends at gate time', async () => {
    const h = makeHarness(makeChecks());
    const startPromise = h.controller.start();
    await waitForLifecycle(h.machine, 'GATE_CONNECTING');
    h.adapter.emit(ended());
    const state = await startPromise;
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.stopReason).toBe('ROOM_ENDED');
  });

  it('stops with SOURCE_ERROR on gate timeout', async () => {
    const h = makeHarness(makeChecks(), 30);
    const startPromise = h.controller.start();
    await waitForLifecycle(h.machine, 'GATE_CONNECTING');
    const state = await startPromise;
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.stopReason).toBe('SOURCE_ERROR');
  });

  it('rejects a second start while running', async () => {
    const h = makeHarness(makeChecks());
    const startPromise = h.controller.start();
    await waitForLifecycle(h.machine, 'GATE_CONNECTING');
    h.adapter.emit(online());
    await startPromise;
    await expect(h.controller.start()).rejects.toBeInstanceOf(ServiceStartConflictError);
  });

  it('stops cleanly from RUNNING with USER_STOP', async () => {
    const h = makeHarness(makeChecks());
    const startPromise = h.controller.start();
    await waitForLifecycle(h.machine, 'GATE_CONNECTING');
    h.adapter.emit(online());
    await startPromise;
    const state = await h.controller.stop();
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.stopReason).toBe('USER_STOP');
    expect(h.cleanupCount()).toBe(1);
    expect(h.sidecar.stopCount).toBe(1);
    expect(h.adapter.isOpen).toBe(false);
  });

  it('stop() during the gate phase resolves the pending start()', async () => {
    const h = makeHarness(makeChecks());
    const startPromise = h.controller.start();
    await waitForLifecycle(h.machine, 'GATE_CONNECTING');
    const stopPromise = h.controller.stop();
    const [startState, stopState] = await Promise.all([startPromise, stopPromise]);
    expect(startState.lifecycle).toBe('STOPPED');
    expect(stopState.lifecycle).toBe('STOPPED');
    expect(stopState.stopReason).toBe('USER_STOP');
    expect(h.sidecar.stopCount).toBe(1);
  });

  it('stop() is a no-op when already STOPPED', async () => {
    const h = makeHarness(makeChecks());
    const state = await h.controller.stop();
    expect(state.lifecycle).toBe('STOPPED');
    expect(h.sidecar.stopCount).toBe(0);
    expect(h.cleanupCount()).toBe(0);
  });

  it('stops with ROOM_ENDED when the room ends while running', async () => {
    const h = makeHarness(makeChecks());
    const startPromise = h.controller.start();
    await waitForLifecycle(h.machine, 'GATE_CONNECTING');
    h.adapter.emit(online());
    await startPromise;
    h.adapter.emit(ended());
    await waitForLifecycle(h.machine, 'STOPPED');
    const state = h.controller.getViewState();
    expect(state.stopReason).toBe('ROOM_ENDED');
    expect(h.sidecar.started).toBe(false);
  });

  it('stops with SOURCE_ERROR when the source errors while running', async () => {
    const h = makeHarness(makeChecks());
    const startPromise = h.controller.start();
    await waitForLifecycle(h.machine, 'GATE_CONNECTING');
    h.adapter.emit(online());
    await startPromise;
    h.adapter.emit(sourceError());
    await waitForLifecycle(h.machine, 'STOPPED');
    const state = h.controller.getViewState();
    expect(state.stopReason).toBe('SOURCE_ERROR');
    expect(h.sidecar.started).toBe(false);
  });

  it('rejects start with E_SIDECAR_START_FAILED when the sidecar fails to start', async () => {
    const h = makeHarness(makeChecks());
    h.sidecar.failStart = true;
    const state = await h.controller.start();
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.recoverableError?.code).toBe('E_SIDECAR_START_FAILED');
    expect(h.adapter.isOpen).toBe(false);
  });

  it('rejects start with E_SOURCE_UNAVAILABLE when the ws connect fails', async () => {
    const h = makeHarness(makeChecks());
    h.adapter.failConnect = true;
    const state = await h.controller.start();
    expect(state.lifecycle).toBe('STOPPED');
    expect(state.recoverableError?.code).toBe('E_SOURCE_UNAVAILABLE');
    expect(h.sidecar.stopCount).toBe(1);
  });

  it('stop() during the gate checks aborts the pending start()', async () => {
    const h = makeHarness(makeChecks({
      getSettings: async () => {
        await delay(20);
        return { roomReference: 'room-abc', providerCredentialRef: 'deepseek-01-key' };
      },
    }));
    const startPromise = h.controller.start();
    await h.controller.stop();
    const state = await startPromise;
    expect(state.lifecycle).toBe('STOPPED');
    expect(h.sidecar.started).toBe(false);
    expect(h.sidecar.stopCount).toBe(0);
  });
});

describe('ServiceController M5-07 integration', () => {
  it('dispatches COMMENT events to the injected onComment while running', async () => {
    const received: string[] = [];
    const machine = new ServiceStateMachine();
    const sidecar = new FakeSidecar();
    const adapter = new FakeAdapter();
    const controller = new ServiceController({
      stateMachine: machine,
      sidecar,
      createAdapter: () => adapter,
      checks: makeChecks(),
      createLiveSession: async () => undefined,
      onComment: (comment) => received.push(comment.sourceMessageId),
      cleanupOnStop: () => undefined,
      gateTimeoutMs: 2000,
    });
    const startPromise = controller.start();
    await waitForLifecycle(machine, 'GATE_CONNECTING');
    adapter.emit(online());
    await startPromise;
    adapter.emit({ type: 'COMMENT', comment: { sourceMessageId: 'm1', rawEvent: {}, rawText: 'hi', normalizedText: 'hi', receivedAt: '2026-08-22T00:00:00.000Z', receivedMonotonicMs: 1 } });
    expect(received).toEqual(['m1']);
  });

  it('forwards the stop reason to cleanupOnStop', async () => {
    const reasons: string[] = [];
    const machine = new ServiceStateMachine();
    const sidecar = new FakeSidecar();
    const adapter = new FakeAdapter();
    const controller = new ServiceController({
      stateMachine: machine,
      sidecar,
      createAdapter: () => adapter,
      checks: makeChecks(),
      createLiveSession: async () => undefined,
      cleanupOnStop: (reason) => reasons.push(reason),
      gateTimeoutMs: 2000,
    });
    const startPromise = controller.start();
    await waitForLifecycle(machine, 'GATE_CONNECTING');
    adapter.emit(online());
    await startPromise;
    await controller.stop('ROOM_ENDED');
    expect(reasons).toEqual(['ROOM_ENDED']);
  });
});
