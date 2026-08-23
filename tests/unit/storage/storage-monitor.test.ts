import { describe, expect, it, vi } from 'vitest';
import {
  CRITICAL_MIN_BYTES,
  StorageMonitor,
  type StorageCapacity,
} from '../../../src/main/storage/index.js';

function volume(availableBytes: number): StorageCapacity {
  return { availableBytes, totalBytes: 8 * 1024 ** 3 };
}

// The interval relies on real timers (no fake timers mixed with the storage
// layer); the re-entrant case asserts the cleared handle directly.
function timerOf(monitor: StorageMonitor): ReturnType<typeof setInterval> | null {
  return (monitor as unknown as { timer: ReturnType<typeof setInterval> | null }).timer;
}

describe('StorageMonitor', () => {
  it('fires onCritical when available space is below the critical threshold', () => {
    const onCritical = vi.fn();
    const monitor = new StorageMonitor({
      readStorage: () => volume(CRITICAL_MIN_BYTES - 1),
      onCritical,
      checkIntervalMs: 60000,
    });
    monitor.check();
    expect(onCritical).toHaveBeenCalledTimes(1);
  });

  it('does not fire onCritical while space stays above the threshold', () => {
    const onCritical = vi.fn();
    const monitor = new StorageMonitor({
      readStorage: () => volume(CRITICAL_MIN_BYTES + 1),
      onCritical,
      checkIntervalMs: 60000,
    });
    monitor.check();
    monitor.check();
    expect(onCritical).not.toHaveBeenCalled();
  });

  it('skips the check when readStorage reports null (unknown volume)', () => {
    const onCritical = vi.fn();
    const monitor = new StorageMonitor({
      readStorage: () => null,
      onCritical,
      checkIntervalMs: 60000,
    });
    monitor.check();
    expect(onCritical).not.toHaveBeenCalled();
  });

  it('is idempotent under repeated start()/stop()', () => {
    const onCritical = vi.fn();
    const monitor = new StorageMonitor({
      readStorage: () => volume(CRITICAL_MIN_BYTES + 1),
      onCritical,
      checkIntervalMs: 60000,
    });
    monitor.start();
    monitor.start();
    monitor.stop();
    monitor.stop();
    expect(onCritical).not.toHaveBeenCalled();
  });

  it('clears the interval when a synchronous onCritical stops the monitor re-entrantly', () => {
    // start() runs an immediate check(); a synchronous onCritical (the service
    // stops via controller.stop) must leave no live interval. Regression for
    // the re-entrant timer leak where the handle was assigned after check().
    const monitorRef: { current: StorageMonitor | null } = { current: null };
    const onCritical = vi.fn(() => {
      monitorRef.current?.stop();
    });
    const monitor = new StorageMonitor({
      readStorage: () => volume(CRITICAL_MIN_BYTES - 1),
      onCritical,
      checkIntervalMs: 20,
    });
    monitorRef.current = monitor;
    monitor.start();
    expect(onCritical).toHaveBeenCalledTimes(1);
    expect(timerOf(monitor)).toBeNull();
  });
});
