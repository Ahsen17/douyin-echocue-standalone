import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { RetentionScheduler } from '../../../src/main/storage/retention-scheduler.js';

describe('RetentionScheduler (WP-3)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-retention-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const statePath = (name = 'default'): string => join(testDir, name, 'retention-state.json');

  function makeAudit(): {
    calls: string[];
    pruneTracesOlderThan: (cutoff: string) => {
      deletedTraces: number;
      deletedSnapshots: number;
      deletedSessions: number;
    };
  } {
    const calls: string[] = [];
    return {
      calls,
      pruneTracesOlderThan: (cutoff) => {
        calls.push(cutoff);
        return { deletedTraces: 3, deletedSnapshots: 4, deletedSessions: 1 };
      },
    };
  }

  const makeSettings = (audit?: unknown): { get: () => Promise<{ audit?: unknown } | null> } => ({
    get: async () => (audit === undefined ? null : { audit }),
  });

  it('prunes on the day\'s first run and skips the same day again, persisting state', async () => {
    const audit = makeAudit();
    const log: string[] = [];
    const scheduler = new RetentionScheduler({
      audit: audit as never,
      settings: makeSettings({ retentionDays: 30 }) as never,
      statePath: statePath(),
      isStopped: () => true,
      log: (m) => log.push(m),
    });
    const first = await scheduler.runOnce();
    expect(first.pruned).toBe(true);
    expect(first.deletedTraces).toBe(3);
    expect(audit.calls).toHaveLength(1);

    const second = await scheduler.runOnce();
    expect(second.pruned).toBe(false);
    expect(audit.calls).toHaveLength(1);

    const raw = await readFile(statePath(), 'utf-8');
    expect(JSON.parse(raw).lastPrunedDay).toBe(new Date().toISOString().slice(0, 10));
  });

  it('defers pruning while the service is running', async () => {
    const audit = makeAudit();
    const scheduler = new RetentionScheduler({
      audit: audit as never,
      settings: makeSettings({ retentionDays: 30 }) as never,
      statePath: statePath(),
      isStopped: () => false,
    });
    const result = await scheduler.runOnce();
    expect(result.pruned).toBe(false);
    expect(audit.calls).toHaveLength(0);
  });

  it('clamps an out-of-range retention and falls back to the default when unset', async () => {
    const daysFromCutoff = (audit: ReturnType<typeof makeAudit>): number =>
      (Date.now() - Date.parse(audit.calls[0])) / 86_400_000;

    const high = makeAudit();
    await new RetentionScheduler({
      audit: high as never,
      settings: makeSettings({ retentionDays: 999 }) as never,
      statePath: statePath('high'),
      isStopped: () => true,
    }).runOnce();
    expect(daysFromCutoff(high)).toBeGreaterThan(179); // clamped to 180

    const low = makeAudit();
    await new RetentionScheduler({
      audit: low as never,
      settings: makeSettings({ retentionDays: 1 }) as never,
      statePath: statePath('low'),
      isStopped: () => true,
    }).runOnce();
    expect(daysFromCutoff(low)).toBeGreaterThan(6); // clamped to 7

    const unset = makeAudit();
    await new RetentionScheduler({
      audit: unset as never,
      settings: makeSettings() as never,
      statePath: statePath('unset'),
      isStopped: () => true,
    }).runOnce();
    expect(daysFromCutoff(unset)).toBeGreaterThan(29); // default 30
  });
});
