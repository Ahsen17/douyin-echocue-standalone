import { describe, it, expect, vi } from 'vitest';
import { createAuditControlHandlers } from '../../../src/main/audit/audit-control-handlers.js';
import type { AuditControlDeps } from '../../../src/main/audit/audit-control-handlers.js';
import type { AuditSearchResponseV1, AuditWorkflowV1 } from '@echocue/contracts';

const TRACE_ID = '01932a3b-4c5d-7000-8000-000000000001';

function makeDeps(overrides: Partial<AuditControlDeps['audit']> = {}): AuditControlDeps {
  const audit = {
    searchTraces: vi.fn().mockImplementation((params: { page: number; pageSize: number }) => ({
      items: [],
      total: 0,
      page: params.page,
      pageSize: params.pageSize,
    } satisfies AuditSearchResponseV1)),
    getTraceWorkflowV1: vi.fn().mockReturnValue(null),
    ...overrides,
  } as unknown as AuditControlDeps['audit'];
  return { audit };
}

describe('audit.search / audit.getWorkflow handlers (M6-09)', () => {
  it('search passes a validated request through', async () => {
    const deps = makeDeps();
    const handlers = createAuditControlHandlers(deps);
    const res = await handlers.search({
      from: '2026-08-22T00:00:00.000Z',
      finalState: 'HIDDEN',
      pageSize: 50,
    });
    expect(res.pageSize).toBe(50);
    expect(deps.audit.searchTraces).toHaveBeenCalledWith(
      expect.objectContaining({ finalState: 'HIDDEN', pageSize: 50 }),
    );
  });

  it('rejects an invalid search request', async () => {
    const deps = makeDeps();
    const handlers = createAuditControlHandlers(deps);
    await expect(handlers.search({ pageSize: 101 })).rejects.toThrow('审计查询参数不合法');
    expect(deps.audit.searchTraces).not.toHaveBeenCalled();
  });

  it('rejects an unknown filter field (strict)', async () => {
    const deps = makeDeps();
    const handlers = createAuditControlHandlers(deps);
    await expect(handlers.search({ results: 'SHOWN' })).rejects.toThrow('审计查询参数不合法');
  });

  it('getWorkflow returns the serializable workflow', async () => {
    const workflow: AuditWorkflowV1 = {
      traceId: TRACE_ID,
      transitions: [{
        sequenceNo: 1,
        fromState: null,
        toState: 'RECEIVED',
        reasonCode: 'EVENT_RECEIVED',
        occurredAt: '2026-08-22T00:00:00.000Z',
        snapshots: [{ snapshotId: 's1', role: 'RAW_WS_EVENT', contentType: 'RAW_EVENT_JSON', plaintext: '{}' }],
      }],
    };
    const deps = makeDeps({ getTraceWorkflowV1: vi.fn().mockReturnValue(workflow) });
    const handlers = createAuditControlHandlers(deps);
    const res = await handlers.getWorkflow({ traceId: TRACE_ID });
    expect(res).toEqual(workflow);
  });

  it('getWorkflow rejects a non-UUID v7 traceId', async () => {
    const deps = makeDeps();
    const handlers = createAuditControlHandlers(deps);
    await expect(handlers.getWorkflow({ traceId: 'not-a-uuid' })).rejects.toThrow('traceId 必须是合法的 UUID v7');
  });

  it('getWorkflow reports a missing trace', async () => {
    const deps = makeDeps({ getTraceWorkflowV1: vi.fn().mockReturnValue(null) });
    const handlers = createAuditControlHandlers(deps);
    await expect(handlers.getWorkflow({ traceId: TRACE_ID })).rejects.toThrow('未找到该条审计');
  });
});
