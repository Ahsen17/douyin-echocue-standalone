import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MainWindow } from '../../../src/main/windows/MainWindow.js';
import { TrayManager } from '../../../src/main/windows/TrayManager.js';

// T-OVR-001 / A-08: closing the main window hides to tray (does not quit), and
// the tray "退出 Echocue" item only quits after an explicit user confirmation.
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
  const menuItems: Array<{ label?: string; type?: string; click?: () => void }> = [];
  return {
    windowObj,
    ipcMain: { on: vi.fn(), removeAllListeners: vi.fn() },
    BrowserWindowMock: vi.fn(() => windowObj),
    TrayMock: vi.fn(() => ({
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn(),
      destroy: vi.fn(),
    })),
    MenuMock: {
      buildFromTemplate: vi.fn((template: Array<{ label?: string; type?: string; click?: () => void }>) => {
        menuItems.push(...template);
        return {};
      }),
    },
    nativeImageMock: {
      createFromDataURL: vi.fn(() => ({})),
      createFromPath: vi.fn(() => ({ isEmpty: () => true })),
    },
    dialogMock: { showMessageBoxSync: vi.fn(() => 0) },
    menuItems,
  };
});

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: mocks.BrowserWindowMock,
  ipcMain: mocks.ipcMain,
  Tray: mocks.TrayMock,
  Menu: mocks.MenuMock,
  nativeImage: mocks.nativeImageMock,
  dialog: mocks.dialogMock,
}));

function closeHandler(): (event: { preventDefault: () => void }) => void {
  const found = mocks.windowObj.on.mock.calls.find(([channel]) => channel === 'close');
  expect(found).toBeDefined();
  return found![1] as (event: { preventDefault: () => void }) => void;
}

describe('MainWindow close-to-tray (T-OVR-001 / A-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('hides to tray and prevents quit on close when not explicitly quitting', () => {
    new MainWindow(() => false);
    const preventDefault = vi.fn();
    closeHandler()({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.windowObj.hide).toHaveBeenCalledTimes(1);
  });

  it('lets the window close through when the app is explicitly quitting', () => {
    new MainWindow(() => true);
    const preventDefault = vi.fn();
    closeHandler()({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mocks.windowObj.hide).not.toHaveBeenCalled();
  });
});

describe('TrayManager exit flow (T-OVR-001 / A-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.menuItems.length = 0;
    mocks.dialogMock.showMessageBoxSync.mockReturnValue(0);
  });

  it('shows the main window from the tray menu', () => {
    const onShow = vi.fn();
    new TrayManager({ onShow, onQuit: vi.fn() });
    const show = mocks.menuItems.find((item) => item.label === '显示主窗口');
    expect(show).toBeDefined();
    show!.click!();
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('quits only after the user confirms the exit dialog', () => {
    const onQuit = vi.fn();
    mocks.dialogMock.showMessageBoxSync.mockReturnValue(1);
    new TrayManager({ onShow: vi.fn(), onQuit });
    const quit = mocks.menuItems.find((item) => item.label === '退出 Echocue');
    expect(quit).toBeDefined();
    quit!.click!();
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('does not quit when the user cancels the exit dialog', () => {
    const onQuit = vi.fn();
    mocks.dialogMock.showMessageBoxSync.mockReturnValue(0);
    new TrayManager({ onShow: vi.fn(), onQuit });
    const quit = mocks.menuItems.find((item) => item.label === '退出 Echocue');
    quit!.click!();
    expect(onQuit).not.toHaveBeenCalled();
  });
});
