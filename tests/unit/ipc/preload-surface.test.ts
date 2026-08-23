import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../../src/shared/ipc-channels.js';

const mocks = vi.hoisted(() => {
  const contextBridge = { exposeInMainWorld: vi.fn() };
  const ipcRenderer = {
    send: vi.fn(),
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  };
  return { contextBridge, ipcRenderer };
});

vi.mock('electron', () => ({
  contextBridge: mocks.contextBridge,
  ipcRenderer: mocks.ipcRenderer,
}));

type Api = Record<string, Record<string, (...args: never[]) => unknown>>;

// Preloads call contextBridge.exposeInMainWorld at module load, so each must be
// dynamically imported after resetModules to re-evaluate and capture a fresh
// surface (static imports would be cached and never re-run).
async function loadPreload(modulePath: string): Promise<Api> {
  vi.resetModules();
  vi.clearAllMocks();
  await import(modulePath);
  const calls = mocks.contextBridge.exposeInMainWorld.mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][1] as unknown as Api;
}

const MAIN_TOP_LEVEL = ['audit', 'config', 'diagnostics', 'overlay', 'persona', 'provider', 'retrieval', 'safety', 'service', 'window'];

describe('preload surfaces (M6-11 / CONTRACT §7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('main preload exposes exactly the main-window allowlist and no overlay-only surface', async () => {
    const api = await loadPreload('../../../src/preload/main-preload.js');
    expect(Object.keys(api).sort()).toEqual(MAIN_TOP_LEVEL.sort());
    expect(Object.keys(api.window).sort()).toEqual(['close', 'minimize', 'maximize', 'onMaximizeChange'].sort());
    expect(Object.keys(api.service).sort()).toEqual(['subscribe', 'start', 'stop'].sort());
    expect(Object.keys(api.provider).sort()).toEqual(['setApiKey', 'clearApiKey', 'testConnection'].sort());
    expect(Object.keys(api.config).sort()).toEqual(['get', 'update'].sort());
    expect(Object.keys(api.persona).sort()).toEqual(
      [
        'list', 'get', 'create', 'delete', 'setPrincipal', 'saveDraft', 'publish',
        'listVersions', 'compare', 'updateAliases',
      ].sort(),
    );
    expect(Object.keys(api.safety).sort()).toEqual(['get', 'saveDraft', 'publish'].sort());
    expect(Object.keys(api.diagnostics).sort()).toEqual(['getSummary'].sort());
    expect(Object.keys(api.retrieval).sort()).toEqual(['getStatus', 'importPreSet'].sort());
    expect(Object.keys(api.audit).sort()).toEqual(['search', 'getWorkflow', 'submitLabel'].sort());
    expect(Object.keys(api.overlay).sort()).toEqual(['updatePreferences'].sort());
    // Overlay-only capabilities must never surface on the main window.
    expect(api.overlay).not.toHaveProperty('onDisplay');
    expect(api.overlay).not.toHaveProperty('onHide');
    expect(api.overlay).not.toHaveProperty('onPreference');
    expect(api.overlay).not.toHaveProperty('ack');
  });

  it('overlay preload exposes ONLY display/hide/preference events and ack', async () => {
    const api = await loadPreload('../../../src/preload/overlay-preload.js');
    expect(Object.keys(api)).toEqual(['overlay']);
    expect(Object.keys(api.overlay).sort()).toEqual(['ack', 'onDisplay', 'onHide', 'onPreference'].sort());
    for (const forbidden of ['window', 'service', 'provider', 'config', 'persona', 'safety', 'diagnostics', 'audit']) {
      expect(api).not.toHaveProperty(forbidden);
    }
    expect(api.overlay).not.toHaveProperty('updatePreferences');
  });

  it('main preload wires each method to the correct channel', async () => {
    const api = await loadPreload('../../../src/preload/main-preload.js');
    api.window.close();
    expect(mocks.ipcRenderer.send).toHaveBeenCalledWith(IpcChannel.WindowClose);
    api.window.minimize();
    expect(mocks.ipcRenderer.send).toHaveBeenCalledWith(IpcChannel.WindowMinimize);
    api.window.maximize();
    expect(mocks.ipcRenderer.send).toHaveBeenCalledWith(IpcChannel.WindowMaximize);

    const unsubscribe = api.service.subscribe(() => undefined);
    expect(mocks.ipcRenderer.on).toHaveBeenCalledWith(IpcChannel.ServiceStateChanged, expect.any(Function));
    expect(mocks.ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannel.ServiceStateSubscribe);
    unsubscribe();
    expect(mocks.ipcRenderer.removeListener).toHaveBeenCalledWith(IpcChannel.ServiceStateChanged, expect.any(Function));
    mocks.ipcRenderer.on.mockClear();
    mocks.ipcRenderer.invoke.mockClear();

    api.config.get();
    expect(mocks.ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannel.ConfigGet);
    const cfgReq = { roomReference: 'room' };
    api.config.update(cfgReq);
    expect(mocks.ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannel.ConfigUpdate, cfgReq);

    api.audit.getWorkflow({ traceId: '0188c8e1-7d4b-7000-a000-000000000000' });
    expect(mocks.ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannel.AuditGetWorkflow, expect.any(Object));

    api.overlay.updatePreferences({ durationMs: 10000 });
    expect(mocks.ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannel.OverlayPreferenceUpdate, expect.any(Object));

    api.retrieval.getStatus();
    expect(mocks.ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannel.RetrievalGetStatus);
    api.retrieval.importPreSet('{"schema_version":"1.0"}');
    expect(mocks.ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannel.RetrievalImportPreSet, { content: '{"schema_version":"1.0"}' });
  });

  it('overlay preload wires display/hide/preference/ack to the correct channels', async () => {
    const api = await loadPreload('../../../src/preload/overlay-preload.js');
    const unsubDisplay = api.overlay.onDisplay(() => undefined);
    expect(mocks.ipcRenderer.on).toHaveBeenCalledWith(IpcChannel.OverlayDisplay, expect.any(Function));
    unsubDisplay();
    expect(mocks.ipcRenderer.removeListener).toHaveBeenCalledWith(IpcChannel.OverlayDisplay, expect.any(Function));

    const unsubHide = api.overlay.onHide(() => undefined);
    expect(mocks.ipcRenderer.on).toHaveBeenCalledWith(IpcChannel.OverlayHide, expect.any(Function));
    unsubHide();
    expect(mocks.ipcRenderer.removeListener).toHaveBeenCalledWith(IpcChannel.OverlayHide, expect.any(Function));

    const unsubPref = api.overlay.onPreference(() => undefined);
    expect(mocks.ipcRenderer.on).toHaveBeenCalledWith(IpcChannel.OverlayPreferenceChanged, expect.any(Function));
    unsubPref();
    expect(mocks.ipcRenderer.removeListener).toHaveBeenCalledWith(IpcChannel.OverlayPreferenceChanged, expect.any(Function));

    api.overlay.ack('req-1');
    expect(mocks.ipcRenderer.invoke).toHaveBeenCalledWith(IpcChannel.OverlayAck, { requestId: 'req-1' });
  });
});
