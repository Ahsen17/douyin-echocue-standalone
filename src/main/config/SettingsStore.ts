/**
 * SettingsStore: Atomic settings.json repository for Echocue MVP.
 *
 * Responsibilities:
 * - Read/write config/settings.json with Zod validation
 * - Atomic write: temp file → fsync → rename
 * - Reject corrupt or unknown fields
 * - Provide defaults on first run
 *
 * Security constraints:
 * - API keys MUST NOT be stored here (use safeStorage/DPAPI)
 * - Only Main process may write
 * - Renderer accesses via whitelisted IPC (M6-03)
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { SettingsV1Schema, type SettingsV1 } from '@echocue/contracts';
import type { ZodError } from 'zod';

export class ConfigCorruptError extends Error {
  constructor(public readonly cause: unknown) {
    super('Settings file is corrupt or invalid');
    this.name = 'ConfigCorruptError';
  }
}

export class SettingsStore {
  private readonly settingsPath: string;
  private readonly tmpPath: string;

  constructor(private readonly dataDir: string) {
    this.settingsPath = join(dataDir, 'config', 'settings.json');
    this.tmpPath = `${this.settingsPath}.tmp`;
  }

  /**
   * Read settings from disk.
   * @returns Settings object, or null if file doesn't exist
   * @throws ConfigCorruptError if file is corrupt or validation fails
   */
  async get(): Promise<SettingsV1 | null> {
    try {
      const content = await fs.readFile(this.settingsPath, 'utf-8');
      const parsed = JSON.parse(content);
      return SettingsV1Schema.parse(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new ConfigCorruptError(err);
    }
  }

  /**
   * Update settings atomically. Creates with defaults if missing.
   * @param partial Partial settings to merge
   */
  async update(partial: Partial<SettingsV1>): Promise<void> {
    const current = await this.get();
    const merged = current ? { ...current, ...partial } : { ...this.getDefaults(), ...partial };

    // Validate before writing
    const validated = SettingsV1Schema.parse(merged);

    await this.atomicWrite(JSON.stringify(validated, null, 2));
  }

  /**
   * Reset to default settings.
   */
  async reset(): Promise<void> {
    const defaults = this.getDefaults();
    await this.atomicWrite(JSON.stringify(defaults, null, 2));
  }

  /**
   * Get default settings for first-run initialization.
   */
  getDefaults(): SettingsV1 {
    return {
      schemaVersion: 1,
      overlay: {
        durationMs: 10000,
        width: 800,
        height: 200,
        opacity: 0.95,
        fontScale: 1.0,
        theme: 'dark',
        clickThrough: false,
      },
      internalRetrieval: {
        calibrationVersion: 'v1.0',
        directPushThreshold: 0.85,
        // 2026-08 校准：默认放宽到 5s，与编排器常量保持一致（当前未接线进运行时）。
        windowMaxAgeMs: 5000,
        candidateMaxCount: 50,
      },
    };
  }

  /**
   * Atomic write: temp file → fsync → rename.
   * Ensures either old or new content, never partial.
   */
  private async atomicWrite(content: string): Promise<void> {
    // Ensure config directory exists
    await fs.mkdir(dirname(this.settingsPath), { recursive: true });

    let fd: fs.FileHandle | null = null;
    try {
      // Write to temp file
      await fs.writeFile(this.tmpPath, content, 'utf-8');

      // fsync to ensure data is on disk
      fd = await fs.open(this.tmpPath, 'r+');
      await fd.sync();
      await fd.close();
      fd = null;

      // Atomic rename
      await fs.rename(this.tmpPath, this.settingsPath);
    } catch (err) {
      // Clean up temp file on failure
      if (fd) {
        await fd.close().catch(() => {});
      }
      await fs.unlink(this.tmpPath).catch(() => {});
      throw err;
    }
  }
}
