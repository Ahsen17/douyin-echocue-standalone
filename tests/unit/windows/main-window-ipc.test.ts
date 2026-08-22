import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../../src/shared/ipc-channels.js';
import { MainWindow } from '../../../src/main/windows/MainWindow.js';

const mocks = vi.hoisted(() => {
  const windowObj = {
    webContents: { id: 1, send: vi.fn() },
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
  };
  const ipcMain = { on: vi.fn(), removeAllListeners: vi.fn() };
  return {
    windowObj,
    ipcMain,
    BrowserWindowMock: vi.fn(() => windowObj),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindowMock,
  ipcMain: mocks.ipcMain,
}));

function captureIpcListeners(): Map<string, (event: { sender: unknown }) => void> {
  const listeners = new Map<string, (event: { sender: unknown }) => void>();
  for (const [channel, listener] of mocks.ipcMain.on.mock.calls) {
    listeners.set(channel, listener);
  }
  return listeners;
}

describe('MainWindow window chrome IPC (M6-11 / CONTRACT §7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers exactly the three window chrome channels', () => {
    new MainWindow(() => false);
    const channels = mocks.ipcMain.on.mock.calls.map(([ch]) => ch);
    expect(channels.sort()).toEqual(
      [IpcChannel.WindowClose, IpcChannel.WindowMinimize, IpcChannel.WindowMaximize].sort(),
    );
  });

  it('acts on the window close/minimize/maximize sent by this window only', () => {
    new MainWindow(() => false);
    const listeners = captureIpcListeners();
    listeners.get(IpcChannel.WindowClose)!({ sender: mocks.windowObj.webContents });
    listeners.get(IpcChannel.WindowMinimize)!({ sender: mocks.windowObj.webContents });
    listeners.get(IpcChannel.WindowMaximize)!({ sender: mocks.windowObj.webContents });
    expect(mocks.windowObj.hide).toHaveBeenCalledTimes(1);
    expect(mocks.windowObj.minimize).toHaveBeenCalledTimes(1);
    expect(mocks.windowObj.maximize).toHaveBeenCalledTimes(1);
  });

  it('ignores an untrusted sender without throwing and without acting', () => {
    new MainWindow(() => false);
    const listeners = captureIpcListeners();
    const foreign = { id: 99 };
    expect(() => listeners.get(IpcChannel.WindowClose)!({ sender: foreign })).not.toThrow();
    expect(() => listeners.get(IpcChannel.WindowMinimize)!({ sender: foreign })).not.toThrow();
    expect(() => listeners.get(IpcChannel.WindowMaximize)!({ sender: foreign })).not.toThrow();
    expect(mocks.windowObj.hide).not.toHaveBeenCalled();
    expect(mocks.windowObj.minimize).not.toHaveBeenCalled();
    expect(mocks.windowObj.maximize).not.toHaveBeenCalled();
  });

  it('toggles maximize when the window is already maximized', () => {
    new MainWindow(() => false);
    const listeners = captureIpcListeners();
    const maximizeEvent = mocks.windowObj.on.mock.calls.find(([ch]) => ch === 'maximize');
    maximizeEvent![1]();
    listeners.get(IpcChannel.WindowMaximize)!({ sender: mocks.windowObj.webContents });
    expect(mocks.windowObj.unmaximize).toHaveBeenCalledTimes(1);
    expect(mocks.windowObj.maximize).not.toHaveBeenCalled();
  });

  it('fails closed after destroy: the window is null so every sender is ignored', () => {
    const win = new MainWindow(() => false);
    const listeners = captureIpcListeners();
    win.destroy();
    expect(mocks.ipcMain.removeAllListeners).toHaveBeenCalledWith(IpcChannel.WindowClose);
    expect(mocks.ipcMain.removeAllListeners).toHaveBeenCalledWith(IpcChannel.WindowMinimize);
    expect(mocks.ipcMain.removeAllListeners).toHaveBeenCalledWith(IpcChannel.WindowMaximize);
    expect(mocks.windowObj.destroy).toHaveBeenCalled();
    mocks.windowObj.hide.mockClear();
    expect(() =>
      listeners.get(IpcChannel.WindowClose)!({ sender: mocks.windowObj.webContents }),
    ).not.toThrow();
    expect(mocks.windowObj.hide).not.toHaveBeenCalled();
  });
});
