import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryWindow } from '../../src/main/windows/HistoryWindow.js';

const mocks = vi.hoisted(() => {
  const webContents = { send: vi.fn(), once: vi.fn(), isLoading: vi.fn(() => false) };
  const windowObj = {
    webContents,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 420, height: 640 })),
    setBounds: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.windowObj.getBounds.mockReturnValue({ x: 0, y: 0, width: 420, height: 640 });
  mocks.windowObj.isDestroyed.mockReturnValue(false);
  mocks.getAllDisplays.mockReturnValue([{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]);
  mocks.getPrimaryDisplay.mockReturnValue({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } });
});

describe('T-HST-001: History Window Behavior', () => {
  it('is created hidden, frameless and right-side with a 420x640 default (history-window)', () => {
    new HistoryWindow();
    expect(mocks.lastOptions).toMatchObject({
      x: 1484, // 1920 - 420 - 16
      y: 220, // (1080 - 640) / 2
      width: 420,
      height: 640,
      frame: false,
      transparent: true,
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
  });

  it('raises to the screen-saver always-on-top level, same as the overlay', () => {
    new HistoryWindow();
    expect(mocks.windowObj.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
  });

  it('reveals only via show() (service RUNNING) using showInactive', () => {
    const win = new HistoryWindow();
    expect(mocks.windowObj.showInactive).not.toHaveBeenCalled();
    win.show();
    expect(mocks.windowObj.showInactive).toHaveBeenCalled();
  });

  it('hide() hides the window', () => {
    const win = new HistoryWindow();
    win.hide();
    expect(mocks.windowObj.hide).toHaveBeenCalled();
  });

  it('send pushes a snapshot to the renderer webContents', () => {
    const win = new HistoryWindow();
    const snap = { entries: [], capacity: 20 };
    win.send('history.snapshot.changed', snap);
    expect(mocks.windowObj.webContents.send).toHaveBeenCalledWith('history.snapshot.changed', snap);
  });

  it('fires onRendererReady once the renderer finishes loading', () => {
    const onRendererReady = vi.fn();
    new HistoryWindow({ onRendererReady });
    const loadCb = mocks.windowObj.webContents.once.mock.calls.find(([ch]) => ch === 'did-finish-load')?.[1];
    expect(loadCb).toBeDefined();
    (loadCb as () => void)();
    expect(onRendererReady).toHaveBeenCalledTimes(1);
  });

  it('isReady reflects the window lifecycle', () => {
    const win = new HistoryWindow();
    expect(win.isReady()).toBe(true);
    mocks.windowObj.isDestroyed.mockReturnValue(true);
    expect(win.isReady()).toBe(false);
  });

  it('restores to a safe position when the last position is off-screen', () => {
    const win = new HistoryWindow();
    mocks.windowObj.getBounds.mockReturnValue({ x: 5000, y: 5000, width: 420, height: 640 });
    win.show();
    expect(mocks.windowObj.setBounds).toHaveBeenCalledWith({
      x: 1920 - 420 - 16,
      y: 1080 - 640 - 16,
      width: 420,
      height: 640,
    });
  });

  it('destroy tears down the BrowserWindow', () => {
    const win = new HistoryWindow();
    win.destroy();
    expect(mocks.windowObj.destroy).toHaveBeenCalled();
    expect(win.isReady()).toBe(false);
  });
});
