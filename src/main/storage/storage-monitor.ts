// RUNBOOK §5.3 / DATA §8.2: 数据卷容量策略。启动要求 ≥ 2 GiB 可用
// （DATA §8.2）；运行期每 60 秒检查，低于 256 MiB 禁止新 attempt 并按
// E_AUDIT_UNAVAILABLE 停服。任何阈值都不得触发自动删除（无清理调用）。
export const STARTUP_MIN_BYTES = 2 * 1024 ** 3;
export const CRITICAL_MIN_BYTES = 256 * 1024 ** 2;

export interface StorageCapacity {
  availableBytes: number;
  totalBytes: number;
}

export interface StorageMonitorOptions {
  readStorage: () => StorageCapacity | null;
  onCritical: () => void;
  checkIntervalMs?: number;
  criticalBytes?: number;
}

/**
 * Periodic data-volume monitor. check() reads the available bytes and fires
 * onCritical once available space drops below the critical threshold; the
 * caller decides the stop action (the service stops with E_AUDIT_UNAVAILABLE,
 * RUNBOOK §5.3). start()/stop() are idempotent.
 */
export class StorageMonitor {
  private readonly readStorage: () => StorageCapacity | null;
  private readonly onCritical: () => void;
  private readonly checkIntervalMs: number;
  private readonly criticalBytes: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: StorageMonitorOptions) {
    this.readStorage = options.readStorage;
    this.onCritical = options.onCritical;
    this.checkIntervalMs = options.checkIntervalMs ?? 60_000;
    this.criticalBytes = options.criticalBytes ?? CRITICAL_MIN_BYTES;
  }

  start(): void {
    if (this.timer !== null) return;
    // Arm the interval before the first check: a synchronous onCritical inside
    // check() may stop() this monitor re-entrantly, and stop() must see the
    // timer to clear it. (Order matters.)
    this.timer = setInterval(() => this.check(), this.checkIntervalMs);
    this.check();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  check(): void {
    // A read failure (e.g. statfs) omits the check, mirroring the diagnostics
    // summary; an unknown volume must not trigger a stop.
    const storage = this.readStorage();
    if (storage === null) return;
    if (storage.availableBytes < this.criticalBytes) this.onCritical();
  }
}
