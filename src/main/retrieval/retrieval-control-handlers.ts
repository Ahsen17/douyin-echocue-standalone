import type {
  PreSetImportErrorV1,
  PreSetImportResultV1,
  RetrievalInitStatusV1,
} from '@echocue/contracts';
import { PreSetImportRequestV1Schema } from '@echocue/contracts';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { QdrantSidecarManager } from '../qdrant/index.js';
import { importPreSet as importPreSetStrict } from './pre-set-importer.js';
import { QDRANT_ALIAS_PRE_SET, bootstrapPreSet } from './bootstrap.js';

export interface RetrievalControlDeps {
  qdrant: QdrantSidecarManager;
  client: QdrantClient;
  /** Import is only legal while the service is stopped (RUNBOOK §8.2). */
  isServiceStopped: () => boolean;
  /** Injectable for unit tests; defaults to the real atomic bootstrap. */
  bootstrap?: typeof bootstrapPreSet;
}

export interface RetrievalControlHandlers {
  getStatus(): Promise<RetrievalInitStatusV1>;
  importPreSet(raw: unknown): Promise<PreSetImportResultV1>;
}

// Bound the IPC error list; the importer reports the whole package, the UI only
// needs the head plus a total marker.
const MAX_REPORTED_ERRORS = 100;

// Core retrieval-init IPC logic, electron-free for unit-testing. getStatus is
// read-only; importPreSet reuses the strict importer + atomic bootstrap so a
// failed package never leaves partial active data (PRESET §7).
export function createRetrievalControlHandlers(deps: RetrievalControlDeps): RetrievalControlHandlers {
  const doBootstrap = deps.bootstrap ?? bootstrapPreSet;
  // Serialize imports: bootstrap is atomic but concurrent runs would race the
  // alias switch, so a new import waits for the previous one to settle.
  let inFlight: Promise<unknown> | null = null;

  const ensureQdrant = async (): Promise<void> => {
    if (await deps.qdrant.isHealthy()) return;
    await deps.qdrant.start();
  };

  const getStatus = async (): Promise<RetrievalInitStatusV1> => {
    if (!(await deps.qdrant.isHealthy())) {
      return { qdrantHealthy: false, ready: false, error: 'E_QDRANT_UNAVAILABLE' };
    }
    try {
      const exists = (await deps.client.collectionExists(QDRANT_ALIAS_PRE_SET)).exists;
      if (!exists) return { qdrantHealthy: true, ready: false };
      const collection = await deps.client.getCollection(QDRANT_ALIAS_PRE_SET);
      const metadata = collection.config?.metadata as Record<string, unknown> | undefined;
      const profileId = typeof metadata?.profile_id === 'string' ? metadata.profile_id : undefined;
      const preSetSha256 = typeof metadata?.pre_set_sha256 === 'string' ? metadata.pre_set_sha256 : undefined;
      return { qdrantHealthy: true, ready: true, profileId, preSetSha256 };
    } catch {
      return { qdrantHealthy: true, ready: false, error: 'E_QDRANT_UNAVAILABLE' };
    }
  };

  const importPreSet = async (raw: unknown): Promise<PreSetImportResultV1> => {
    const parsed = PreSetImportRequestV1Schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error('导入请求不合法');
    }
    if (!deps.isServiceStopped()) {
      throw new Error('服务运行中，请先停止服务后再导入检索数据');
    }
    const content = parsed.data.content;
    if (inFlight) await inFlight;
    const task = (async (): Promise<PreSetImportResultV1> => {
      await ensureQdrant();
      const imported = importPreSetStrict({ content });
      if (!imported.ok) {
        const errors: PreSetImportErrorV1[] = imported.errors;
        return {
          ok: false,
          errors: errors.slice(0, MAX_REPORTED_ERRORS),
          truncated: errors.length > MAX_REPORTED_ERRORS,
        };
      }
      const profile = await doBootstrap(deps.client, { content });
      return { ok: true, profile, entryCount: imported.entries.length };
    })();
    const tracked = task.catch(() => undefined);
    inFlight = tracked;
    try {
      return await task;
    } finally {
      if (inFlight === tracked) inFlight = null;
    }
  };

  return { getStatus, importPreSet };
}
