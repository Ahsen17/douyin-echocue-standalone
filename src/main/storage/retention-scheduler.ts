import { promises as fs } from 'fs';
import { dirname } from 'path';
import type { SettingsStore } from '../config/SettingsStore.js';
import type { AuditStoreWorker } from './AuditStoreWorker.js';

const RETENTION_MIN = 7;
const RETENTION_MAX = 180;
const RETENTION_DEFAULT = 30;

export interface RetentionSchedulerOptions {
  audit: AuditStoreWorker;
  settings: SettingsStore;
  /** JSON state file persisting the last cleanup day across app runs. */
  statePath: string;
  /** Only prune while the service is not RUNNING (avoids write contention). */
  isStopped: () => boolean;
  log?: (message: string) => void;
}

export interface RetentionRunResult {
  pruned: boolean;
  deletedTraces: number;
  deletedSnapshots: number;
  deletedSessions: number;
}

function clampDays(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(RETENTION_MAX, Math.max(RETENTION_MIN, Math.floor(value)));
  }
  return RETENTION_DEFAULT;
}

/**
 * WP-3 audit retention: prune expired traces once per day, on the day's first
 * app run. The last-cleaned day is persisted so a restart the same day skips;
 * while the service is RUNNING the run is deferred to keep audit writes quiet.
 */
export class RetentionScheduler {
  constructor(private readonly opts: RetentionSchedulerOptions) {}

  async runOnce(): Promise<RetentionRunResult> {
    const today = new Date().toISOString().slice(0, 10);
    if ((await this.readState()) === today) {
      return { pruned: false, deletedTraces: 0, deletedSnapshots: 0, deletedSessions: 0 };
    }
    if (!this.opts.isStopped()) {
      return { pruned: false, deletedTraces: 0, deletedSnapshots: 0, deletedSessions: 0 };
    }
    const retentionDays = clampDays((await this.readSettings())?.audit?.retentionDays);
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const result = this.opts.audit.pruneTracesOlderThan(cutoff);
    await this.writeState(today);
    this.opts.log?.(`audit retention: pruned ${result.deletedTraces} traces older than ${retentionDays}d`);
    return { pruned: true, ...result };
  }

  private async readSettings() {
    try {
      return await this.opts.settings.get();
    } catch {
      return null;
    }
  }

  private async readState(): Promise<string | null> {
    try {
      const raw = await fs.readFile(this.opts.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as { lastPrunedDay?: unknown };
      return typeof parsed.lastPrunedDay === 'string' ? parsed.lastPrunedDay : null;
    } catch {
      return null;
    }
  }

  private async writeState(day: string): Promise<void> {
    try {
      await fs.mkdir(dirname(this.opts.statePath), { recursive: true });
      await fs.writeFile(this.opts.statePath, JSON.stringify({ lastPrunedDay: day }, null, 2), 'utf-8');
    } catch {
      // best-effort: a failed state write only re-prunes on the next launch
    }
  }
}
