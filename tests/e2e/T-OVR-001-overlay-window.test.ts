import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlayDisplayPayloadV1, OverlayPreferenceV1 } from '@echocue/contracts';
import { OverlayWindow } from '../../src/main/windows/OverlayWindow.js';

const mocks = vi.hoisted(() => {
  const webContents = {
    send: vi.fn(),
    isLoading: vi.fn(() => false),
    once: vi.fn(),
  };
  const windowObj = {
    webContents,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn(),
    setSize: vi.fn(),
    setBounds: vi.fn(),
    setOpacity: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    getSize: vi.fn(() => [800, 200]),
    getOpacity: vi.fn(() => 1),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 200 })),
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
  };
  let lastOptions: Record<string, unknown> | null = null;
  return {
    get lastOptions() {
      return lastOptions;
    },
    windowObj,
    BrowserWindowMock: vi.fn((opts?: Record<string, unknown>) => {
      lastOptions = opts ?? null;
      return windowObj;
    }),
    getAllDisplays: vi.fn(() => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]),
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindowMock,
  screen: {
    getAllDisplays: mocks.getAllDisplays,
    getPrimaryDisplay: mocks.getPrimaryDisplay,
  },
}));

const PREFS: OverlayPreferenceV1 = {
  durationMs: 10_000,
  width: 800,
  height: 200,
  opacity: 0.95,
  fontScale: 1.0,
  theme: 'dark',
  clickThrough: false,
};

const PAYLOAD: OverlayDisplayPayloadV1 = {
  comment: { nickname: '观众A', text: '主播晚上好' },
  suggestion: {
    quickReply: '今天状态是被你们夸出来的',
    cues: ['接住夸奖', '邀请互动', '延展话题'],
    source: 'llm',
  },
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.windowObj.getBounds.mockReturnValue({ x: 0, y: 0, width: 800, height: 200 });
  mocks.windowObj.getOpacity.mockReturnValue(1);
  mocks.getAllDisplays.mockReturnValue([{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]);
  mocks.getPrimaryDisplay.mockReturnValue({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } });
});

describe('T-OVR-001: Overlay Window Behavior', () => {
  it('displays a validated suggestion and resolves the first-frame ack', async () => {
    const win = new OverlayWindow({ getSettings: async () => null });
    const pending = win.showSuggestion(PAYLOAD, 'req-1');
    await flush();
    expect(mocks.windowObj.webContents.send).toHaveBeenCalledWith('overlay.renderSuggestion', {
      requestId: 'req-1',
      payload: PAYLOAD,
    });
    expect(mocks.windowObj.showInactive).toHaveBeenCalled();
    win.ack('req-1');
    const result = await pending;
    expect(result).toMatchObject({ ok: true });
    expect(typeof (result as { ok: true }).firstFrameAtMonotonicMs).toBe('number');
  });

  it('raises the overlay to the screen-saver always-on-top level by default (TD-06)', () => {
    // TD-06 浮窗默认置顶：构造即把层级提升到 screen-saver，压过全屏直播/采集软件。
    const win = new OverlayWindow({ getSettings: async () => null });
    expect(mocks.windowObj.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
  });

  it('seeds the default position horizontal-center, vertical middle-lower (UI §5)', () => {
    // Primary 1920x1080, default 800x200 → x centered at 560, y at 60% of
    // usable height (528) so the overlay sits in the lower-middle, not centered.
    new OverlayWindow({ getSettings: async () => null });
    expect(mocks.lastOptions).toMatchObject({
      x: 560,
      y: 528,
      width: 800,
      height: 200,
    });
  });

  it('re-seeds the position from the prefs-applied size on first show (M3)', async () => {
    // The construction seed uses DEFAULT size (settings not loaded yet); once
    // prefs are known, the first show re-centers using the real size.
    // Primary 1920x1080 with 600x300 prefs → x=(1920-600)/2=660, y=(1080-300)*0.6=468.
    mocks.windowObj.getBounds.mockReturnValue({ x: 0, y: 0, width: 600, height: 300 });
    const win = new OverlayWindow({
      getSettings: async () => ({ ...PREFS, width: 600, height: 300 }),
    });
    const pending = win.showSuggestion(PAYLOAD, 'req-m3');
    await flush();
    expect(mocks.windowObj.setBounds).toHaveBeenCalledWith({
      x: 660,
      y: 468,
      width: 600,
      height: 300,
    });
    win.ack('req-m3');
    await pending;
  });

  it('hides the overlay when the display window ends', async () => {
    const win = new OverlayWindow({ getSettings: async () => null });
    await win.hideSuggestion();
    expect(mocks.windowObj.webContents.send).toHaveBeenCalledWith('overlay.hide');
    expect(mocks.windowObj.hide).toHaveBeenCalled();
  });

  it('passes mouse clicks through when click-through is enabled', async () => {
    const win = new OverlayWindow({ getSettings: async () => null });
    await win.applyPreferences({ ...PREFS, clickThrough: true });
    expect(mocks.windowObj.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
    mocks.windowObj.setIgnoreMouseEvents.mockClear();
    await win.applyPreferences({ ...PREFS, clickThrough: false });
    expect(mocks.windowObj.setIgnoreMouseEvents).toHaveBeenCalledWith(false, { forward: true });
  });

  it('keeps a single display in flight and does not self-render a second frame', async () => {
    const win = new OverlayWindow({ getSettings: async () => null });
    const pending = win.showSuggestion(PAYLOAD, 'req-1');
    await flush();
    const renderCalls = () =>
      mocks.windowObj.webContents.send.mock.calls.filter(([ch]) => ch === 'overlay.renderSuggestion');
    expect(renderCalls()).toHaveLength(1);
    // While the display window is pending, the sink/window never emits a second
    // render on its own — the DISPLAYING guard lives upstream in the orchestrator.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(renderCalls()).toHaveLength(1);
    win.ack('req-1');
    await pending;
  });

  it('restores to a safe position when the last position is off-screen', async () => {
    const win = new OverlayWindow({ getSettings: async () => null });
    // First show seeds the default position and sets the seed flag.
    const first = win.showSuggestion(PAYLOAD, 'req-2a');
    await flush();
    win.ack('req-2a');
    await first;
    // Simulate the user dragging the overlay off-screen, then a fresh show.
    mocks.windowObj.getBounds.mockReturnValue({ x: 5000, y: 5000, width: 800, height: 200 });
    const pending = win.showSuggestion(PAYLOAD, 'req-2');
    await flush();
    // Primary 1920x1080, window 800x200 → bottom-right corner with 16px margin.
    // The seed flag is set, so ensureOnScreen clamps without re-centering.
    expect(mocks.windowObj.setBounds).toHaveBeenCalledWith({
      x: 1920 - 800 - 16,
      y: 1080 - 200 - 16,
      width: 800,
      height: 200,
    });
    win.ack('req-2');
    await pending;
  });

  it('fails with OVERLAY_ACK_TIMEOUT when the renderer never acks', async () => {
    const win = new OverlayWindow({ getSettings: async () => null, ackTimeoutMs: 10 });
    const pending = win.showSuggestion(PAYLOAD, 'req-3');
    const result = await pending;
    expect(result).toEqual({ ok: false, reason: 'OVERLAY_ACK_TIMEOUT' });
  });

  it('clears pending acks on destroy and rejects new shows', async () => {
    const win = new OverlayWindow({ getSettings: async () => null, ackTimeoutMs: 1000 });
    const pending = win.showSuggestion(PAYLOAD, 'req-4');
    await flush();
    win.destroy();
    mocks.windowObj.isDestroyed.mockReturnValue(true);
    // ack after destroy is a no-op (cleared), and new shows fail closed.
    expect(win.ack('req-4')).toBe(false);
    await expect(
      win.showSuggestion(PAYLOAD, 'req-5'),
    ).resolves.toEqual({ ok: false, reason: 'overlay unavailable' });
    // the pre-destroy pending show resolves promptly — no hang on quit.
    const result = await pending;
    expect(result).toEqual({ ok: false, reason: 'OVERLAY_DESTROYED' });
  });
});
