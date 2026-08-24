import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DataLocationStore,
  moveDataRoot,
  validateMoveDataRoot,
} from '../../../src/main/config/DataLocationStore.js';

describe('DataLocationStore (WP-5)', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-dataloc-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const pointer = (name = 'pointer.json') => join(testDir, 'pointer', name);
  const store = (name?: string) => new DataLocationStore(pointer(name));

  it('read returns null when the pointer is absent or corrupt', async () => {
    expect(await store('missing').read()).toBeNull();
    expect(await store('read').readSync()).toBeNull();

    await mkdir(join(testDir, 'pointer'));
    await writeFile(pointer('bad'), 'not json', 'utf8');
    expect(await store('bad').read()).toBeNull();

    await writeFile(pointer('badver'), '{"schemaVersion":9,"dataRoot":"x"}', 'utf8');
    expect(await store('badver').read()).toBeNull();
  });

  it('read returns the data root when the pointer is valid and the dir exists', async () => {
    const dataDir = join(testDir, 'data');
    await mkdir(dataDir);
    await store().write(dataDir);
    expect(await store().read()).toBe(dataDir);
    expect(store().readSync()).toBe(dataDir);
  });

  it('write also mirrors the plain-text pointer for the uninstaller (WP-6), forward-slashed', async () => {
    const target = join(testDir, 'migrated', 'data dir');
    await mkdir(target, { recursive: true });
    await store().write(target);
    // txt lives next to the json pointer (pointer/pointer.txt).
    const txtPath = join(testDir, 'pointer', 'pointer.txt');
    const raw = await readFile(txtPath, 'utf8');
    expect(raw).toBe(`${join(testDir, 'migrated', 'data dir').replaceAll('\\', '/')}\r\n`);
    expect(await store().read()).toBe(join(testDir, 'migrated', 'data dir').replaceAll('\\', '/'));
  });

  it('read ignores a pointer whose target directory no longer exists', async () => {
    const dataDir = join(testDir, 'gone');
    await store().write(dataDir);
    await rm(dataDir, { recursive: true, force: true });
    expect(await store().read()).toBeNull();
  });

  it('validateMoveDataRoot rejects relative, same-dir, install-dir, and non-empty targets', async () => {
    const current = join(testDir, 'data');
    const install = join(testDir, 'install');
    await mkdir(current);
    await mkdir(install);

    expect(await validateMoveDataRoot(current, install, 'relative/path')).toMatchObject({ ok: false });
    expect(await validateMoveDataRoot(current, install, current)).toMatchObject({ ok: false });
    expect(await validateMoveDataRoot(current, install, install)).toMatchObject({ ok: false });
    expect(await validateMoveDataRoot(current, install, join(install, 'sub'))).toMatchObject({ ok: false });

    const nonEmpty = join(testDir, 'nonempty');
    await mkdir(nonEmpty);
    await writeFile(join(nonEmpty, 'x.txt'), 'x', 'utf8');
    expect(await validateMoveDataRoot(current, install, nonEmpty)).toMatchObject({ ok: false });

    const empty = join(testDir, 'empty');
    await mkdir(empty);
    expect(await validateMoveDataRoot(current, install, empty)).toEqual({ ok: true });
  });

  it('moveDataRoot copies the tree and rolls back on failure', async () => {
    const current = join(testDir, 'data');
    await mkdir(join(current, 'audit'), { recursive: true });
    await writeFile(join(current, 'audit', 'audit.sqlite'), 'db', 'utf8');
    await writeFile(join(current, 'settings.json'), '{}', 'utf8');

    const target = join(testDir, 'moved');
    expect(await moveDataRoot(current, target)).toEqual({ ok: true });
    expect(await readFile(join(target, 'audit', 'audit.sqlite'), 'utf8')).toBe('db');
    expect(await readFile(join(target, 'settings.json'), 'utf8')).toBe('{}');

    // Genuine copy failure (a file blocks the target path): ok:false.
    const fileBlock = join(testDir, 'fileblock');
    await writeFile(fileBlock, 'file', 'utf8');
    const result = await moveDataRoot(current, join(fileBlock, 'sub'));
    expect(result.ok).toBe(false);
  });
});
