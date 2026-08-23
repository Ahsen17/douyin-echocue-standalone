import {
  AuditGetWorkflowRequestV1Schema,
  AuditSearchRequestV1Schema,
  AuditSearchResponseV1Schema,
  AuditSubmitLabelRequestV1Schema,
  AuditSubmitLabelResponseV1Schema,
} from '@echocue/contracts';
import type {
  AuditSearchResponseV1,
  AuditSubmitLabelResponseV1,
  AuditWorkflowV1,
} from '@echocue/contracts';
import type { AuditStoreWorker } from '../storage/index.js';

export interface AuditControlDeps {
  audit: AuditStoreWorker;
  /**
   * Fired after a label revision commits, so the golden sync worker can reflux
   * immediately (M7-01). Fire-and-forget; never blocks the IPC response.
   */
  onLabelSubmitted?: () => void;
}

export interface AuditControlHandlers {
  search: (raw: unknown) => Promise<AuditSearchResponseV1>;
  getWorkflow: (raw: unknown) => Promise<AuditWorkflowV1 | null>;
  submitLabel: (raw: unknown) => Promise<AuditSubmitLabelResponseV1>;
}

// Core audit IPC logic (CONTRACT §7). These channels are main-window only and
// gated by the authorized audit page; overlay never reaches them.
export function createAuditControlHandlers(deps: AuditControlDeps): AuditControlHandlers {
  return {
    async search(raw) {
      const parsed = AuditSearchRequestV1Schema.safeParse(raw);
      if (!parsed.success) throw new Error('审计查询参数不合法');
      const result = deps.audit.searchTraces(parsed.data);
      // Defensive: a worker bug must not leak a malformed response across IPC.
      return AuditSearchResponseV1Schema.parse(result);
    },
    async getWorkflow(raw) {
      const parsed = AuditGetWorkflowRequestV1Schema.safeParse(raw);
      if (!parsed.success) throw new Error('traceId 必须是合法的 UUID v7');
      const workflow = deps.audit.getTraceWorkflowV1(parsed.data.traceId);
      if (workflow === null) throw new Error('未找到该条审计');
      return workflow;
    },
    async submitLabel(raw) {
      const parsed = AuditSubmitLabelRequestV1Schema.safeParse(raw);
      if (!parsed.success) throw new Error('打标参数不合法');
      // UI §8.2 场景约束: 修正答案必须携带有效分（schema 已保证 reply/cues 同现）。
      if (parsed.data.correctedQuickReply !== undefined && parsed.data.score <= 0) {
        throw new Error('修正答案质量分必须大于 0');
      }
      const labelStatus = deps.audit.submitLabel(parsed.data);
      // M7-01: reflux immediately after the outbox row commits. Not awaited so a
      // Qdrant outage never delays the label response.
      void deps.onLabelSubmitted?.();
      return AuditSubmitLabelResponseV1Schema.parse({ labelStatus });
    },
  };
}
