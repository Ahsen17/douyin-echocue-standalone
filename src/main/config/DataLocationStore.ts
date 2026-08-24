import { accessSync, existsSync, readFileSync } from 'node:fs';
import { access, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative } from 'node:path';

// WP-5: fixed boot pointer for the data-save location. The app reads this BEFORE
// deciding userData; the pointer file itself never moves with the data root.
export interface DataLocationFileV1 {
  schemaVersion: 1;
  dataRoot: string;
}

export class DataLocationStore {
  private readonly txtPath: string;

  constructor(private readonly pointerPath: string) {
    // WP-6 uninstaller reads the plain-text pointer; keep both in sync.
    this.txtPath = pointerPath.replace(/\.json$/, '.txt');
  }

  /** Reads a valid pointer; null when absent, corrupt, or pointing at a removed dir. */
  async read(): Promise<string | null> {
    try {
      return readValidPointer(this.pointerPath, this.txtPath);
    } catch {
      return null;
    }
  }

  /** Synchronous boot-time read; the pointer is read before app ready. */
  readSync(): string | null {
    try {
      return readValidPointer(this.pointerPath, this.txtPath);
    } catch {
      return null;
    }
  }

  async write(dataRoot: string): Promise<void> {
    const dir = dirname(this.pointerPath);
    await mkdir(dir, { recursive: true });
    // Forward-slash normalize: Windows user input with backslashes would make the
    // JSON invalid (unescaped \x escapes), and both Node and NSIS accept '/'.
    const fwd = dataRoot.replaceAll('\\', '/');
    const body = JSON.stringify({ schemaVersion: 1, dataRoot: fwd } satisfies DataLocationFileV1);
    await writeFile(this.pointerPath, body, 'utf8');
    // Mirror into the plain-text pointer the NSIS uninstaller reads (WP-6), so
    // /cleanData removes the real (migrated) root, not a stale one.
    await writeFile(this.txtPath, `${fwd}\r\n`, 'utf8');
  }
}

// Shared sync validator; throws on any corrupt/absent/missing-target pointer.
// The plain-text pointer (installer + in-app migration write it) is primary; the
// JSON pointer is the legacy fallback. Whitespace is trimmed (the installer file
// has no trailing newline, but a leftover one must not corrupt the path).
function readValidPointer(pointerPath: string, txtPath: string): string {
  if (existsSync(txtPath)) {
    const raw = readFileSync(txtPath, 'utf8').trim();
    if (raw !== '') {
      accessSync(raw);
      return raw;
    }
  }
  if (!existsSync(pointerPath)) throw new Error('pointer missing');
  const raw = readFileSync(pointerPath, 'utf8');
  const parsed = JSON.parse(raw) as Partial<DataLocationFileV1>;
  if (parsed.schemaVersion !== 1 || typeof parsed.dataRoot !== 'string' || parsed.dataRoot.trim() === '') {
    throw new Error('pointer corrupt');
  }
  accessSync(parsed.dataRoot);
  return parsed.dataRoot;
}

export type MoveDataRootResult =
  | { ok: true }
  | { ok: false; error: string };

// Preconditions for an in-app data-root relocation (WP-5.3). The target must be
// an absolute path, differ from the current root, live outside the install dir,
// and be empty or nonexistent (a non-empty target is refused to avoid clobbering).
export async function validateMoveDataRoot(
  currentRoot: string,
  installDir: string,
  targetDir: string,
): Promise<MoveDataRootResult> {
  if (!isAbsolute(targetDir)) return { ok: false, error: '目标必须是绝对路径' };
  if (targetDir === currentRoot) return { ok: false, error: '目标与当前数据目录相同' };
  const relToInstall = relative(installDir, targetDir);
  if (relToInstall === '' || (!relToInstall.startsWith('..') && !isAbsolute(relToInstall))) {
    return { ok: false, error: '不能选择安装目录及其子目录' };
  }
  try {
    await access(targetDir);
  } catch {
    return { ok: true };
  }
  try {
    const entries = await readDirNonEmpty(targetDir);
    if (entries) return { ok: false, error: '目标目录非空，为避免覆盖请选择空目录' };
  } catch {
    return { ok: false, error: '无法读取目标目录' };
  }
  return { ok: true };
}

async function readDirNonEmpty(dir: string): Promise<boolean> {
  return (await readdir(dir)).length > 0;
}

/** Copies the data root into an empty target. On failure the target is best-effort removed. */
export async function moveDataRoot(currentRoot: string, targetDir: string): Promise<MoveDataRootResult> {
  try {
    await cp(currentRoot, targetDir, { recursive: true, force: false });
    return { ok: true };
  } catch (err) {
    // Roll back the partial copy so no half-migrated data is left behind.
    try {
      await rm(targetDir, { recursive: true, force: true });
    } catch {
      /* best-effort rollback */
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
