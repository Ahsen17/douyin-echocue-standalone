import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import type { OverlayDisplayPayloadV1, OverlayPreferenceV1, SettingsV1 } from '@echocue/contracts'
import { IpcChannel } from '../../shared/ipc-channels.js'

// Mirrors SettingsStore.getDefaults().overlay for the pre-bootstrap window.
const DEFAULT_OVERLAY_PREFS: OverlayPreferenceV1 = {
  durationMs: 10_000,
  width: 800,
  height: 200,
  opacity: 0.95,
  fontScale: 1.0,
  theme: 'dark',
  clickThrough: false,
};

const DEFAULT_ACK_TIMEOUT_MS = 1500;

// UI §5 default position: horizontal center, vertical middle-lower — the overlay
// occupies the lower portion of the screen, never vertically centered.
export function defaultOverlayPosition(
  workArea: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: workArea.x + Math.round((workArea.width - size.width) / 2),
    y: workArea.y + Math.round((workArea.height - size.height) * 0.6),
  };
}

export type OverlayShowResult =
  | { ok: true; firstFrameAtMonotonicMs: number }
  | { ok: false; reason: string };

export interface OverlayWindowOptions {
  /** Lazy settings access; null before the service controller assembles. */
  getSettings: () => Promise<SettingsV1 | null>;
  /** First-frame ack budget; overridable for tests. */
  ackTimeoutMs?: number;
}

interface PendingAck {
  resolve: (result: OverlayShowResult) => void;
  timer: NodeJS.Timeout;
}

/**
 * Standalone always-on-top overlay (UI §5): frameless transparent window that
 * renders one validated suggestion until the display duration ends. Position
 * survives show/hide cycles on the same BrowserWindow instance; prefs.size only
 * forces the window when the preference itself changes (manual resize wins).
 */
export class OverlayWindow {
  private window: BrowserWindow | null = null;
  private readonly getSettings: () => Promise<SettingsV1 | null>;
  private readonly ackTimeoutMs: number;
  private readonly pendingAcks = new Map<string, PendingAck>();
  private lastAppliedSize: { width: number; height: number } | null = null;
  private positionSeeded = false;

  constructor(options: OverlayWindowOptions) {
    this.getSettings = options.getSettings;
    this.ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.createWindow();
  }

  private createWindow(): void {
    // Default position (UI §5): horizontal center, vertical middle-lower — the
    // overlay occupies the lower portion of the screen, never vertically
    // centered. Settings may not be loaded at construction (eager window), so
    // this seeds with DEFAULT size; showSuggestion() re-seeds once the real
    // prefs size is known (review M3).
    const { x, y } = defaultOverlayPosition(
      screen.getPrimaryDisplay().workArea,
      { width: DEFAULT_OVERLAY_PREFS.width, height: DEFAULT_OVERLAY_PREFS.height },
    );
    this.window = new BrowserWindow({
      x,
      y,
      width: DEFAULT_OVERLAY_PREFS.width,
      height: DEFAULT_OVERLAY_PREFS.height,
      minWidth: 320,
      minHeight: 120,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      // Never auto-show at construction; only showSuggestion() reveals it.
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: join(__dirname, '../preload/overlay-preload.cjs'),
      },
    });

    if (process.env.NODE_ENV === 'development') {
      void this.window.loadURL('http://localhost:5173/overlay/index.html');
    } else {
      void this.window.loadFile(join(__dirname, '../renderer/overlay/index.html'));
    }
    // TD-06 浮窗默认置顶：提升到 screen-saver 层级，压过全屏直播/采集软件；
    // 若过度可降级为 setAlwaysOnTop(true)（默认 floating 层级）。
    this.window.setAlwaysOnTop(true, 'screen-saver');
  }

  public getWindow(): BrowserWindow | null {
    return this.window;
  }

  /** Show a suggestion and resolve once the overlay renderer acks its first frame. */
  public async showSuggestion(
    payload: OverlayDisplayPayloadV1,
    requestId: string,
  ): Promise<OverlayShowResult> {
    if (this.window === null || this.window.isDestroyed()) {
      return { ok: false, reason: 'overlay unavailable' };
    }
    await this.waitReady();
    await this.applyPreferences(await this.readPrefs());
    this.ensureOnScreen();
    // First show only: re-seed the default position from the prefs-applied size
    // (the construction seed used DEFAULT size). Later shows keep the dragged
    // spot — the seed flag stays set for the window's lifetime (review M3).
    this.seedDefaultPosition();
    // Re-read after the awaits: a destroy() during them nulls the instance.
    const win = this.window;
    if (win === null || win.isDestroyed()) return { ok: false, reason: 'overlay unavailable' };
    win.webContents.send(IpcChannel.OverlayDisplay, { requestId, payload });
    win.showInactive();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(requestId);
        resolve({ ok: false, reason: 'OVERLAY_ACK_TIMEOUT' });
      }, this.ackTimeoutMs);
      timer.unref?.();
      this.pendingAcks.set(requestId, {
        // t_end = main-process monotonic clock at ack receipt, same source as t0.
        resolve: (result) => resolve(result),
        timer,
      });
    });
  }

  public async hideSuggestion(): Promise<void> {
    const win = this.window;
    if (win === null || win.isDestroyed()) return;
    win.webContents.send(IpcChannel.OverlayHide);
    win.hide();
  }

  /** True when the ack matched a pending display; false for stale/unknown ids. */
  public ack(requestId: string): boolean {
    const pending = this.pendingAcks.get(requestId);
    if (pending === undefined) return false;
    this.pendingAcks.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve({ ok: true, firstFrameAtMonotonicMs: performance.now() });
    return true;
  }

  /** Re-apply feasible visual prefs to the live window (UI §7 即时应用). */
  public async applyPreferences(prefs: OverlayPreferenceV1): Promise<void> {
    const win = this.window;
    if (win === null || win.isDestroyed()) return;
    if (
      this.lastAppliedSize === null ||
      this.lastAppliedSize.width !== prefs.width ||
      this.lastAppliedSize.height !== prefs.height
    ) {
      win.setSize(prefs.width, prefs.height);
      this.lastAppliedSize = { width: prefs.width, height: prefs.height };
    }
    if (win.getOpacity() !== prefs.opacity) win.setOpacity(prefs.opacity);
    win.setIgnoreMouseEvents(prefs.clickThrough, { forward: true });
    win.webContents.send(IpcChannel.OverlayPreferenceChanged, prefs);
  }

  public destroy(): void {
    this.window?.destroy();
    this.window = null;
    // Resolve in-flight shows so the display path never hangs on quit.
    for (const pending of this.pendingAcks.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, reason: 'OVERLAY_DESTROYED' });
    }
    this.pendingAcks.clear();
  }

  private async readPrefs(): Promise<OverlayPreferenceV1> {
    const settings = await this.getSettings();
    return settings?.overlay ?? DEFAULT_OVERLAY_PREFS;
  }

  private async waitReady(): Promise<void> {
    const wc = this.window?.webContents;
    if (wc === undefined || wc.isLoading() === false) return;
    // Bounded wait: a load failure must not hang the display path forever.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 2000);
      timer.unref?.();
      wc.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private seedDefaultPosition(): void {
    const win = this.window;
    if (win === null || win.isDestroyed() || this.positionSeeded) return;
    this.positionSeeded = true;
    const { x, y } = defaultOverlayPosition(screen.getPrimaryDisplay().workArea, win.getBounds());
    win.setBounds({ x, y, width: win.getBounds().width, height: win.getBounds().height });
  }

  /** Last position must stay on a display; otherwise fall back to primary's corner. */
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
    // Clamp into the work area so an oversized window still stays on-screen.
    win.setBounds({
      x: Math.max(primary.x, primary.x + primary.width - bounds.width - 16),
      y: Math.max(primary.y, primary.y + primary.height - bounds.height - 16),
      width: bounds.width,
      height: bounds.height,
    });
  }
}
