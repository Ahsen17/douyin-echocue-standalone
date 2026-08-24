import { ipcMain, type WebContents } from 'electron';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { IpcChannel } from '../../shared/ipc-channels.js';
import { createGuardedHandler } from '../ipc/guarded-handler.js';
import type { QdrantSidecarManager } from '../qdrant/index.js';
import type { CompiledRiskFilter } from '../safety/risk-filter-config.js';
import { createRetrievalControlHandlers } from './retrieval-control-handlers.js';

export interface RetrievalControlIpcOptions {
  qdrant: QdrantSidecarManager;
  qdrantClient: QdrantClient;
  isTrustedSender: (contents: WebContents) => boolean;
  /** Import is only legal while the service is stopped (RUNBOOK §8.2). */
  isServiceStopped: () => boolean;
  /** WP-10: live read of the compiled risk filter for import rejection. */
  getRiskFilter?: () => Promise<CompiledRiskFilter | null>;
}

// CONTRACT §7: retrieval init status + pre_set import from the main window only.
// getStatus is read-only; importPreSet accepts the JSONL content string and never
// returns case payloads (only profile facts or line-scoped error codes).
export function wireRetrievalControl(options: RetrievalControlIpcOptions): void {
  const { qdrant, qdrantClient, isTrustedSender, isServiceStopped, getRiskFilter } = options;
  const handlers = createRetrievalControlHandlers({ qdrant, client: qdrantClient, isServiceStopped, getRiskFilter });

  ipcMain.handle(IpcChannel.RetrievalGetStatus, createGuardedHandler(isTrustedSender, () => handlers.getStatus()));
  ipcMain.handle(IpcChannel.RetrievalImportPreSet, createGuardedHandler(isTrustedSender, (raw) => handlers.importPreSet(raw)));
  ipcMain.handle(IpcChannel.RetrievalGetCollectionCounts, createGuardedHandler(isTrustedSender, () => handlers.getCollectionCounts()));
}
