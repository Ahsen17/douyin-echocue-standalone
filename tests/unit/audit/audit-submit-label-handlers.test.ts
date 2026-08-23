import { describe, it, expect, vi } from 'vitest';
import { createAuditControlHandlers } from '../../../src/main/audit/audit-control-handlers.js';
import type { AuditControlDeps } from '../../../src/main/audit/audit-control-handlers.js';
import type { AuditSubmitLabelRequestV1 } from '@echocue/contracts';

const TRACE_ID = '01932a3b-4c5d-7000-8000-000000000001';

function makeDeps(
  submitLabelImpl: () => 'ACCEPTED' | 'REJECTED' | 'CORRECTED' = () => 'ACCEPTED',
  onLabelSubmitted: () => void = () => undefined,
): AuditControlDeps {
  return {
    audit: {
      submitLabel: vi.fn().mockImplementation(submitLabelImpl),
    } as unknown as AuditControlDeps['audit'],
    onLabelSubmitted,
  };
}

function validRequest(): AuditSubmitLabelRequestV1 {
  return { traceId: TRACE_ID, expectedRevisionNo: 0, score: 85 };
}

describe('audit.submitLabel handler (M6-10)', () => {
  it('accepts an approve request', async () => {
    const deps = makeDeps();
    const handlers = createAuditControlHandlers(deps);
    const res = await handlers.submitLabel(validRequest());
    expect(res.labelStatus).toBe('ACCEPTED');
    expect(deps.audit.submitLabel).toHaveBeenCalledWith(validRequest());
  });

  it('accepts a reject request at score 0', async () => {
    const deps = makeDeps(() => 'REJECTED');
    const handlers = createAuditControlHandlers(deps);
    const res = await handlers.submitLabel({ traceId: TRACE_ID, expectedRevisionNo: 0, score: 0 });
    expect(res.labelStatus).toBe('REJECTED');
  });

  it('accepts a corrected request with reply and cues', async () => {
    const deps = makeDeps(() => 'CORRECTED');
    const handlers = createAuditControlHandlers(deps);
    const res = await handlers.submitLabel({
      traceId: TRACE_ID,
      expectedRevisionNo: 1,
      score: 85,
      correctedQuickReply: '谢谢大家！',
      correctedCues: ['接住夸奖', '邀请互动'],
    });
    expect(res.labelStatus).toBe('CORRECTED');
  });

  it('rejects a corrected label with score 0', async () => {
    const deps = makeDeps();
    const handlers = createAuditControlHandlers(deps);
    await expect(handlers.submitLabel({
      traceId: TRACE_ID,
      expectedRevisionNo: 0,
      score: 0,
      correctedQuickReply: 'x',
      correctedCues: ['一', '二'],
    })).rejects.toThrow('修正答案质量分必须大于 0');
  });

  it('rejects an invalid request (unknown field)', async () => {
    const deps = makeDeps();
    const handlers = createAuditControlHandlers(deps);
    await expect(handlers.submitLabel({ ...validRequest(), leaked: 1 })).rejects.toThrow('打标参数不合法');
  });

  it('rejects a non-UUID v7 traceId', async () => {
    const deps = makeDeps();
    const handlers = createAuditControlHandlers(deps);
    await expect(handlers.submitLabel({ ...validRequest(), traceId: 'nope' })).rejects.toThrow('打标参数不合法');
  });

  it('fires onLabelSubmitted after a successful label commit (M7-01)', async () => {
    const onLabelSubmitted = vi.fn();
    const deps = makeDeps(() => 'ACCEPTED', onLabelSubmitted);
    const handlers = createAuditControlHandlers(deps);
    await handlers.submitLabel(validRequest());
    expect(onLabelSubmitted).toHaveBeenCalledTimes(1);
  });

  it('does not fire onLabelSubmitted when the label request is invalid', async () => {
    const onLabelSubmitted = vi.fn();
    const deps = makeDeps(() => 'ACCEPTED', onLabelSubmitted);
    const handlers = createAuditControlHandlers(deps);
    await expect(handlers.submitLabel({ ...validRequest(), leaked: 1 })).rejects.toThrow('打标参数不合法');
    expect(onLabelSubmitted).not.toHaveBeenCalled();
  });
});
