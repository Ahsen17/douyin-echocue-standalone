import type {
  CollectionCountsV1,
  PreSetImportErrorV1,
  PreSetImportResultV1,
  RetrievalInitStatusV1,
} from '@echocue/contracts';
import { PreSetImportRequestV1Schema } from '@echocue/contracts';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { QdrantSidecarManager } from '../qdrant/index.js';
import { importPreSet as importPreSetStrict } from './pre-set-importer.js';
import { QDRANT_ALIAS_GOLDEN_SET, QDRANT_ALIAS_PRE_SET, bootstrapPreSet } from './bootstrap.js';

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
  getCollectionCounts(): Promise<CollectionCountsV1>;
}

// Bound the IPC error list; the importer reports the whole package, the UI only
// needs the head plus a total marker.
const MAX_REPORTED_ERRORS = 100;
// The strict importer can surface an unvalidated id/path from a schema-failing
// line; clamp so the IPC contract (id ≤68, path ≤128) stays valid on the wire.
const MAX_ERROR_ID = 68;
const MAX_ERROR_PATH = 128;

// Core retrieval-init IPC logic, electron-free for unit-testing. getStatus is
// read-only; importPreSet reuses the strict importer + atomic bootstrap so a
// failed package never leaves partial active data (PRESET §7).
export function createRetrievalControlHandlers(deps: RetrievalControlDeps): RetrievalControlHandlers {
  const doBootstrap = deps.bootstrap ?? bootstrapPreSet;
  // Serialize imports as a promise chain: bootstrap is atomic but concurrent
  // runs would race the alias switch, so every call queues behind the previous
  // one. The chain tail never rejects, so a failed import does not poison the
  // next queued call.
  let chain: Promise<unknown> = Promise.resolve();

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

  // Diagnostic-only counts (UI §8.1): anonymous point totals per collection so
  // the host can verify golden_set backflow. Absent/empty collections report 0;
  // any qdrant failure also reports 0 rather than surfacing internal errors.
  const getCollectionCounts = async (): Promise<CollectionCountsV1> => {
    const countOf = async (alias: string): Promise<number> => {
      try {
        const { count } = await deps.client.count(alias, { exact: true });
        return count ?? 0;
      } catch {
        return 0;
      }
    };
    return {
      preSetPointCount: await countOf(QDRANT_ALIAS_PRE_SET),
      goldenSetPointCount: await countOf(QDRANT_ALIAS_GOLDEN_SET),
    };
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
    const prev = chain;
    const task = (async (): Promise<PreSetImportResultV1> => {
      await prev;
      // Re-check after the queue wait: the service may have started while this
      // import was queued behind another (RUNBOOK §8.2 requires a stopped state).
      if (!deps.isServiceStopped()) {
        throw new Error('服务运行中，请先停止服务后再导入检索数据');
      }
      await ensureQdrant();
      const imported = importPreSetStrict({ content });
      if (!imported.ok) {
        return {
          ok: false,
          errors: imported.errors.slice(0, MAX_REPORTED_ERRORS).map(toContractError),
          truncated: imported.errors.length > MAX_REPORTED_ERRORS,
        };
      }
      const profile = await doBootstrap(deps.client, { content });
      return { ok: true, profile, entryCount: imported.entries.length };
    })();
    chain = task.catch(() => undefined);
    return task;
  };

  return { getStatus, importPreSet, getCollectionCounts };
}

function toContractError(error: PreSetImportErrorV1): PreSetImportErrorV1 {
  return {
    line: error.line,
    ...(error.id !== undefined && error.id.length > 0 ? { id: error.id.slice(0, MAX_ERROR_ID) } : {}),
    ...(error.path !== undefined && error.path.length > 0 ? { path: error.path.slice(0, MAX_ERROR_PATH) } : {}),
    errorCode: error.errorCode,
  };
}
