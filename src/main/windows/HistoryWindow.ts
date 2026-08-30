import { BrowserWindow, screen } from 'electron';
import { join } from 'path';

const DEFAULT_SIZE = { width: 420, height: 640 };
const MIN_SIZE = { width: 300, height: 240 };

export interface HistoryWindowOptions {
  /** Fired once the renderer finishes loading; lets wiring re-push prefs/capacity. */
  onRendererReady?: () => void;
}

// Default position: right edge of the primary display, vertically centered — the
// history feed sits beside the stream, clear of the bottom-center overlay.
function defaultPosition(
  workArea: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: workArea.x + Math.max(0, workArea.width - size.width - 16),
    y: workArea.y + Math.round((workArea.height - size.height) / 2),
  };
}

/**
 * History-window feed (gap task history-window): a frameless always-on-top
 * floating panel showing the last N displayed suggestions, newest at the bottom.
 * In-memory only; the window stays hidden until the service runs, and is hidden
 * again (feed cleared) on service stop. The renderer is a pure view — all
 * mutations arrive as main-pushed HistorySnapshotChanged events.
 */
export class HistoryWindow {
  private window: BrowserWindow | null = null;

  constructor(options: HistoryWindowOptions = {}) {
    const { x, y } = defaultPosition(screen.getPrimaryDisplay().workArea, DEFAULT_SIZE);
    this.window = new BrowserWindow({
      x,
      y,
      width: DEFAULT_SIZE.width,
      height: DEFAULT_SIZE.height,
      minWidth: MIN_SIZE.width,
      minHeight: MIN_SIZE.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      // Never auto-show at construction; only the service RUNNING state reveals it.
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(__dirname, '../preload/history-preload.cjs'),
      },
    });

    if (process.env.NODE_ENV === 'development') {
      void this.window.loadURL('http://localhost:5173/history/index.html');
    } else {
      void this.window.loadFile(join(__dirname, '../renderer/history/index.html'));
    }
    // Same top-most level as the overlay: the history feed must not be covered by
    // full-screen streaming software while the streamer reviews it.
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.webContents.once('did-finish-load', () => options.onRendererReady?.());
  }

  public getWindow(): BrowserWindow | null {
    return this.window;
  }

  public isReady(): boolean {
    const win = this.window;
    return win !== null && !win.isDestroyed();
  }

  public show(): void {
    const win = this.window;
    if (win === null || win.isDestroyed()) return;
    this.ensureOnScreen();
    win.showInactive();
  }

  public hide(): void {
    this.window?.hide();
  }

  public send(channel: string, payload: unknown): void {
    const win = this.window;
    if (win === null || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  }

  public destroy(): void {
    this.window?.destroy();
    this.window = null;
  }

  /** A dragged-off-screen window falls back to the primary display's corner. */
  private ensureOnScreen(): void {
    const win = this.window;
    if (win === null || win.isDestroyed()) return;
    const bounds = win.getBounds();
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return (
        bounds.x < area.x + area.width &&
        bounds.x + bounds.width > area.x &&
        bounds.y < area.y + area.height &&
        bounds.y + bounds.height > area.y
      );
    });
    if (visible) return;
    const primary = screen.getPrimaryDisplay().workArea;
    win.setBounds({
      x: Math.max(primary.x, primary.x + primary.width - bounds.width - 16),
      y: Math.max(primary.y, primary.y + primary.height - bounds.height - 16),
      width: bounds.width,
      height: bounds.height,
    });
  }
}
