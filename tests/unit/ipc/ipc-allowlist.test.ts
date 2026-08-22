import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../../src/shared/ipc-channels.js';
import { wireServiceControl } from '../../../src/main/service/service-control-ipc.js';
import { wireStateBroadcast } from '../../../src/main/service/state-broadcast.js';
import { wireProviderControl } from '../../../src/main/provider/provider-control-ipc.js';
import { wireConfigControl } from '../../../src/main/config/config-control-ipc.js';
import { wirePersonaControl } from '../../../src/main/persona/persona-control-ipc.js';
import { wireSafetyControl } from '../../../src/main/safety/safety-control-ipc.js';
import { wireAuditControl } from '../../../src/main/audit/audit-control-ipc.js';
import { wireDiagnosticsControl } from '../../../src/main/telemetry/diagnostics-control-ipc.js';
import { wireOverlayControl } from '../../../src/main/overlay/overlay-control-ipc.js';

// Tests bypass tsc (tests/ is excluded from tsconfig), so domain stubs are
// loosely typed and cast to the option types only for readability.
const mocks = vi.hoisted(() => {
  const registered = new Map<string, (event: { sender: unknown }, raw?: unknown) => unknown>();
  const ipcMain = {
    handle: vi.fn(
      (channel: string, handler: (event: { sender: unknown }, raw?: unknown) => unknown) => {
        registered.set(channel, handler);
      },
    ),
  };
  return { registered, ipcMain };
});

vi.mock('electron', () => ({ ipcMain: mocks.ipcMain }));

function registerMainWires(isTrustedSender: (contents: unknown) => boolean): void {
  wireServiceControl({ controller: {}, isTrustedSender: isTrustedSender as never });
  wireStateBroadcast({
    stateMachine: { onChanged: vi.fn(), getViewState: vi.fn() },
    isTrustedSender: isTrustedSender as never,
  });
  wireProviderControl({ configService: {}, isTrustedSender: isTrustedSender as never });
  wireConfigControl({ settings: {}, providerConfig: {}, isTrustedSender: isTrustedSender as never });
  wirePersonaControl({ persona: {}, isTrustedSender: isTrustedSender as never });
  wireSafetyControl({ safety: {}, isTrustedSender: isTrustedSender as never });
  wireAuditControl({ audit: {}, isTrustedSender: isTrustedSender as never });
  wireDiagnosticsControl({ diagnostics: {}, isTrustedSender: isTrustedSender as never });
}

function registerOverlayWire(isOverlayTrustedSender: (contents: unknown) => boolean): void {
  wireOverlayControl({ overlayWindow: { ack: vi.fn() }, isOverlayTrustedSender: isOverlayTrustedSender as never });
}

function call(channel: string, sender: { id: number }, raw?: unknown): unknown {
  const handler = mocks.registered.get(channel);
  if (!handler) throw new Error(`no handler registered for ${channel}`);
  return handler({ sender }, raw);
}

const HANDLE_CHANNELS = [
  IpcChannel.ServiceStart,
  IpcChannel.ServiceStop,
  IpcChannel.ServiceStateSubscribe,
  IpcChannel.ProviderCredentialSet,
  IpcChannel.ProviderCredentialClear,
  IpcChannel.ProviderCredentialTest,
  IpcChannel.ConfigGet,
  IpcChannel.ConfigUpdate,
  IpcChannel.OverlayPreferenceUpdate,
  IpcChannel.PersonaList,
  IpcChannel.PersonaGet,
  IpcChannel.PersonaCreate,
  IpcChannel.PersonaDelete,
  IpcChannel.PersonaSetPrincipal,
  IpcChannel.PersonaSaveDraft,
  IpcChannel.PersonaPublish,
  IpcChannel.PersonaListVersions,
  IpcChannel.PersonaCompare,
  IpcChannel.PersonaUpdateAliases,
  IpcChannel.SafetyGet,
  IpcChannel.SafetySaveDraft,
  IpcChannel.SafetyPublish,
  IpcChannel.DiagnosticsGetSummary,
  IpcChannel.AuditSearch,
  IpcChannel.AuditGetWorkflow,
  IpcChannel.AuditSubmitLabel,
  IpcChannel.OverlayAck,
].sort();

const BROADCAST_ONLY = [
  IpcChannel.WindowMaximizeChanged,
  IpcChannel.ServiceStateChanged,
  IpcChannel.OverlayDisplay,
  IpcChannel.OverlayHide,
  IpcChannel.OverlayPreferenceChanged,
];

describe('IPC handle allowlist (M6-11 / CONTRACT §7)', () => {
  beforeEach(() => {
    mocks.registered.clear();
    vi.clearAllMocks();
  });

  it('registers exactly the 27 request channels and no broadcast/send-only channel', () => {
    registerMainWires(() => true);
    registerOverlayWire(() => true);
    const registered = [...mocks.registered.keys()].sort();
    expect(registered).toEqual(HANDLE_CHANNELS);
    expect(mocks.registered.size).toBe(HANDLE_CHANNELS.length);
    for (const broadcast of BROADCAST_ONLY) {
      expect(mocks.registered.has(broadcast)).toBe(false);
    }
    // A channel outside the allowlist has no handler, so Electron rejects an
    // invoke with "No handler registered" — the renderer gets a rejection.
    expect(mocks.registered.has('some.unknown.channel')).toBe(false);
  });

  it('wires each control to exactly its own channels', () => {
    const trusted = () => true;
    wireServiceControl({ controller: {}, isTrustedSender: trusted as never });
    expect([...mocks.registered.keys()].sort()).toEqual([IpcChannel.ServiceStart, IpcChannel.ServiceStop].sort());

    mocks.registered.clear();
    wireStateBroadcast({ stateMachine: { onChanged: vi.fn(), getViewState: vi.fn() }, isTrustedSender: trusted as never });
    expect([...mocks.registered.keys()]).toEqual([IpcChannel.ServiceStateSubscribe]);

    mocks.registered.clear();
    wireProviderControl({ configService: {}, isTrustedSender: trusted as never });
    expect([...mocks.registered.keys()].sort()).toEqual(
      [IpcChannel.ProviderCredentialSet, IpcChannel.ProviderCredentialClear, IpcChannel.ProviderCredentialTest].sort(),
    );

    mocks.registered.clear();
    wireConfigControl({ settings: {}, providerConfig: {}, isTrustedSender: trusted as never });
    expect([...mocks.registered.keys()].sort()).toEqual(
      [IpcChannel.ConfigGet, IpcChannel.ConfigUpdate, IpcChannel.OverlayPreferenceUpdate].sort(),
    );

    mocks.registered.clear();
    wirePersonaControl({ persona: {}, isTrustedSender: trusted as never });
    expect([...mocks.registered.keys()].sort()).toEqual(
      [
        IpcChannel.PersonaList,
        IpcChannel.PersonaGet,
        IpcChannel.PersonaCreate,
        IpcChannel.PersonaDelete,
        IpcChannel.PersonaSetPrincipal,
        IpcChannel.PersonaSaveDraft,
        IpcChannel.PersonaPublish,
        IpcChannel.PersonaListVersions,
        IpcChannel.PersonaCompare,
        IpcChannel.PersonaUpdateAliases,
      ].sort(),
    );

    mocks.registered.clear();
    wireSafetyControl({ safety: {}, isTrustedSender: trusted as never });
    expect([...mocks.registered.keys()].sort()).toEqual(
      [IpcChannel.SafetyGet, IpcChannel.SafetySaveDraft, IpcChannel.SafetyPublish].sort(),
    );

    mocks.registered.clear();
    wireAuditControl({ audit: {}, isTrustedSender: trusted as never });
    expect([...mocks.registered.keys()].sort()).toEqual(
      [IpcChannel.AuditSearch, IpcChannel.AuditGetWorkflow, IpcChannel.AuditSubmitLabel].sort(),
    );

    mocks.registered.clear();
    wireDiagnosticsControl({ diagnostics: {}, isTrustedSender: trusted as never });
    expect([...mocks.registered.keys()]).toEqual([IpcChannel.DiagnosticsGetSummary]);

    mocks.registered.clear();
    registerOverlayWire(trusted);
    expect([...mocks.registered.keys()]).toEqual([IpcChannel.OverlayAck]);
  });

  it('rejects an untrusted sender before any domain logic on every channel', () => {
    const mainWc = { id: 1 };
    const trusted = (contents: unknown) => contents === mainWc;
    registerMainWires(trusted);
    registerOverlayWire(trusted);
    const foreign = { id: 99 };
    for (const channel of mocks.registered.keys()) {
      expect(() => call(channel, foreign, {}), `${channel} must reject an untrusted sender`).toThrow(
        /rejected: untrusted sender/,
      );
    }
  });

  it('rejects an overlay sender on every main-window channel and a main sender on overlay.ack', () => {
    const mainWc = { id: 1 };
    const overlayWc = { id: 2 };
    registerMainWires((contents) => contents === mainWc);
    registerOverlayWire((contents) => contents === overlayWc);
    for (const channel of mocks.registered.keys()) {
      if (channel === IpcChannel.OverlayAck) continue;
      expect(() => call(channel, overlayWc), `${channel} must reject an overlay sender`).toThrow(
        /rejected: untrusted sender/,
      );
    }
    expect(() => call(IpcChannel.OverlayAck, mainWc)).toThrow(/rejected: untrusted sender/);
  });

  it('reaches the intended domain handler for a trusted sender (representative per wire)', async () => {
    const mainWc = { id: 1 };
    const isMain = (contents: unknown) => contents === mainWc;

    const controller = { start: vi.fn().mockResolvedValue({ lifecycle: 'STOPPED', activity: 'IDLE' }), stop: vi.fn() };
    wireServiceControl({ controller: controller as never, isTrustedSender: isMain as never });
    await expect(call(IpcChannel.ServiceStart, mainWc)).resolves.toEqual({ lifecycle: 'STOPPED', activity: 'IDLE' });
    expect(controller.start).toHaveBeenCalledTimes(1);
    mocks.registered.clear();

    const configService = {
      testConnection: vi.fn().mockResolvedValue({ status: 'UNAVAILABLE' }),
      setApiKey: vi.fn(),
      clearApiKey: vi.fn(),
    };
    wireProviderControl({ configService: configService as never, isTrustedSender: isMain as never });
    await expect(call(IpcChannel.ProviderCredentialTest, mainWc)).resolves.toEqual({ status: 'UNAVAILABLE' });
    expect(configService.testConnection).toHaveBeenCalledTimes(1);
    mocks.registered.clear();

    const persona = { listPersonas: vi.fn().mockResolvedValue([]) };
    wirePersonaControl({ persona: persona as never, isTrustedSender: isMain as never });
    await expect(call(IpcChannel.PersonaList, mainWc)).resolves.toEqual([]);
    expect(persona.listPersonas).toHaveBeenCalledTimes(1);
    mocks.registered.clear();

    const audit = {
      searchTraces: vi.fn(() => ({ items: [], total: 0, page: 1, pageSize: 20 })),
      getTraceWorkflowV1: vi.fn(),
      submitLabel: vi.fn(),
    };
    wireAuditControl({ audit: audit as never, isTrustedSender: isMain as never });
    await expect(call(IpcChannel.AuditSearch, mainWc, { page: 1, pageSize: 20 })).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    expect(audit.searchTraces).toHaveBeenCalledTimes(1);
    mocks.registered.clear();

    const safety = {
      listVersions: vi.fn(() => []),
      getActivePublishedVersion: vi.fn().mockResolvedValue(null),
    };
    wireSafetyControl({ safety: safety as never, isTrustedSender: isMain as never });
    await expect(call(IpcChannel.SafetyGet, mainWc)).resolves.toEqual({
      activeVersion: null,
      current: null,
      versions: [],
    });
    expect(safety.listVersions).toHaveBeenCalledTimes(1);
    mocks.registered.clear();

    const diagnostics = { getSummary: vi.fn().mockResolvedValue({ lifecycle: 'STOPPED', activity: 'IDLE' }) };
    wireDiagnosticsControl({ diagnostics: diagnostics as never, isTrustedSender: isMain as never });
    await expect(call(IpcChannel.DiagnosticsGetSummary, mainWc)).resolves.toEqual({
      lifecycle: 'STOPPED',
      activity: 'IDLE',
    });
    expect(diagnostics.getSummary).toHaveBeenCalledTimes(1);
    mocks.registered.clear();

    const overlayWindow = { ack: vi.fn() };
    wireOverlayControl({ overlayWindow: overlayWindow as never, isOverlayTrustedSender: isMain as never });
    call(IpcChannel.OverlayAck, mainWc, { requestId: 'req-1' });
    expect(overlayWindow.ack).toHaveBeenCalledWith('req-1');
  });
});
