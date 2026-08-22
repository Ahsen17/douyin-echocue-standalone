import { describe, expect, it } from 'vitest';
import type { CompiledSafetyRuleV1 } from '../../../src/main/safety/index.js';
import { SuggestionOutputValidator } from '../../../src/main/validation/index.js';
import type {
  CandidateSuggestion,
  OutputValidationContext,
  TeamMemberNameV1,
} from '../../../src/main/validation/index.js';

const MEMBERS: readonly TeamMemberNameV1[] = [
  { personaId: 'p-1', displayName: '主播A', enabledAliases: ['阿A', 'A姐'] },
  { personaId: 'p-2', displayName: '主播B', enabledAliases: ['小B'] },
];

const RULES: readonly CompiledSafetyRuleV1[] = [
  { ruleType: 'KEYWORD', category: 'TEAM_FORBIDDEN', text: '私聊' },
  { ruleType: 'KEYWORD', category: 'TEAM_FORBIDDEN', text: '加微信' },
];

const VALID: CandidateSuggestion = {
  quick_reply: '谢谢你一直在呀',
  cues: ['接住陪伴', '自然带动互动'],
};

function makeContext(overrides: Partial<OutputValidationContext> = {}): OutputValidationContext {
  const base = {
    source: 'llm' as const,
    personaSnapshot: {
      personaId: 'p-1',
      personaVersion: '01932a3b-4c5d-7000-8000-000000000002',
      content: '你是一个温柔、爱笑的直播出镜人员。',
      contentHmac: 'deadbeef',
    },
    safetySnapshot: {
      version: '01932a3b-4c5d-7000-8000-000000000003',
      policyText: '不讨论医疗、金融、政治与竞品话题。',
      keywords: ['私聊'],
    },
    compiledRules: RULES as never,
    memberNames: MEMBERS,
    currentPersonaId: 'p-1',
    forbiddenPromiseTerms: ['保证返利', '承诺保本'],
    expected: { sessionId: 's1', traceId: 't1', windowVersion: 1 },
    actual: { sessionId: 's1', traceId: 't1', windowVersion: 1 },
    nowMonotonicMs: 1000,
    freshnessDeadlineMonotonicMs: 10000,
  };
  return { ...base, ...overrides } as OutputValidationContext;
}

const validator = new SuggestionOutputValidator();

function expectRejected(candidate: CandidateSuggestion, reason: string, overrides = {}) {
  const result = validator.validate(candidate, makeContext(overrides));
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.kind).toBe('REJECTED');
  if (result.kind === 'REJECTED') expect(result.reasonCodes).toContain(reason);
}

describe('SuggestionOutputValidator', () => {
  it('accepts a valid llm output and stamps source', () => {
    const result = validator.validate(VALID, makeContext());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output.quickReply).toBe(VALID.quick_reply);
      expect(result.output.cues).toEqual(VALID.cues);
      expect(result.output.source).toBe('llm');
    }
  });

  it('accepts a golden retrieval_payload output and stamps source', () => {
    const result = validator.validate(
      { quick_reply: '谢谢你！', cues: ['接住夸奖', '继续互动'] },
      makeContext({ source: 'retrieval_payload' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.source).toBe('retrieval_payload');
  });

  describe('parse + schema', () => {
    it('rejects a non-object candidate as JSON_PARSE_FAILED', () => {
      const result = validator.validate(null as never, makeContext());
      expect(result.ok).toBe(false);
      if (!result.ok && result.kind === 'REJECTED') {
        expect(result.reasonCodes).toEqual(['JSON_PARSE_FAILED']);
      }
    });

    it('rejects a top-level array as JSON_PARSE_FAILED', () => {
      const result = validator.validate([1, 2] as never, makeContext());
      expect(result.ok).toBe(false);
      if (!result.ok && result.kind === 'REJECTED') {
        expect(result.reasonCodes).toEqual(['JSON_PARSE_FAILED']);
      }
    });

    it('rejects non-string cues as JSON_SCHEMA_FAILED', () => {
      expectRejected({ quick_reply: '感谢', cues: ['一', 2 as never] }, 'JSON_SCHEMA_FAILED');
    });

    it('rejects a non-string quick_reply as JSON_SCHEMA_FAILED', () => {
      expectRejected({ quick_reply: 123 as never, cues: ['一', '二'] }, 'JSON_SCHEMA_FAILED');
    });

    it('rejects extra fields as JSON_SCHEMA_FAILED', () => {
      const result = validator.validate(
        { quick_reply: '感谢', cues: ['一', '二'], extra: true } as never,
        makeContext(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok && result.kind === 'REJECTED') {
        expect(result.reasonCodes).toEqual(['JSON_SCHEMA_FAILED']);
      }
    });

    it('rejects a missing field as JSON_SCHEMA_FAILED', () => {
      const result = validator.validate({ quick_reply: '感谢' } as never, makeContext());
      expect(result.ok).toBe(false);
      if (!result.ok && result.kind === 'REJECTED') {
        expect(result.reasonCodes).toEqual(['JSON_SCHEMA_FAILED']);
      }
    });
  });

  describe('normalization', () => {
    it('rejects invisible control characters as UNSAFE_CONTROL_CHAR', () => {
      expectRejected({ quick_reply: '感谢\u0000', cues: ['一', '二'] }, 'UNSAFE_CONTROL_CHAR');
      expectRejected({ quick_reply: '感谢', cues: ['一\u200b', '二'] }, 'UNSAFE_CONTROL_CHAR');
    });

    it('returns the normalized (NFKC) string on success', () => {
      const result = validator.validate(
        { quick_reply: ' 感谢 支持  ', cues: ['　欢迎关注　', ' 点赞收藏 '] },
        makeContext(),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output.quickReply).toBe('感谢 支持');
        expect(result.output.cues).toEqual(['欢迎关注', '点赞收藏']);
      }
    });
  });

  describe('structure & length', () => {
    it('rejects empty or only-punctuation quick_reply', () => {
      expectRejected({ quick_reply: '！！！', cues: ['一', '二'] }, 'EMPTY_QUICK_REPLY');
      expectRejected({ quick_reply: '   ', cues: ['一', '二'] }, 'EMPTY_QUICK_REPLY');
    });

    it('rejects quick_reply over 80 han as QUICK_REPLY_TOO_LONG', () => {
      expectRejected({ quick_reply: '汉'.repeat(81), cues: ['一', '二'] }, 'QUICK_REPLY_TOO_LONG');
    });

    it('accepts exactly 80 han in quick_reply', () => {
      const result = validator.validate(
        { quick_reply: '汉'.repeat(80), cues: ['一', '二'] },
        makeContext(),
      );
      expect(result.ok).toBe(true);
    });

    it('rejects a cue over 40 han as CUE_TOO_LONG', () => {
      expectRejected(
        { quick_reply: '感谢', cues: ['这'.repeat(41), '二'] },
        'CUE_TOO_LONG',
      );
    });

    it('accepts a cue of exactly 40 han', () => {
      const result = validator.validate(
        { quick_reply: '感谢', cues: ['这'.repeat(40), '二'] },
        makeContext(),
      );
      expect(result.ok).toBe(true);
    });

    it('rejects 1 or 4 cues as CUE_COUNT_INVALID', () => {
      expectRejected({ quick_reply: '感谢', cues: ['只有一条'] }, 'CUE_COUNT_INVALID');
      expectRejected({ quick_reply: '感谢', cues: ['一', '二', '三', '四'] }, 'CUE_COUNT_INVALID');
    });

    it('rejects an empty cue as CUE_EMPTY', () => {
      expectRejected({ quick_reply: '感谢', cues: ['', '二'] }, 'CUE_EMPTY');
      expectRejected({ quick_reply: '感谢', cues: ['。。', '二'] }, 'CUE_EMPTY');
    });

    it('rejects duplicate cues after normalization as CUE_DUPLICATE', () => {
      expectRejected(
        { quick_reply: '感谢', cues: ['重复提词', ' 重复提词 '] },
        'CUE_DUPLICATE',
      );
    });
  });

  describe('safety & taboo', () => {
    it('maps a compiled rule hit to FORBIDDEN_POLICY_HIT', () => {
      expectRejected(
        { quick_reply: '想了解就私聊我', cues: ['一', '二'] },
        'FORBIDDEN_POLICY_HIT',
      );
    });

    it('maps a PII builtin hit to PERSONAL_INFO_HIT', () => {
      expectRejected(
        { quick_reply: '加我微信号 123456', cues: ['一', '二'] },
        'PERSONAL_INFO_HIT',
      );
    });

    it('fails closed to RISK_RULE_HIT when the safety engine errors', () => {
      const result = validator.validate(VALID, makeContext({ compiledRules: null }));
      expect(result.ok).toBe(false);
      if (!result.ok && result.kind === 'REJECTED') {
        expect(result.reasonCodes).toContain('RISK_RULE_HIT');
      }
    });
  });

  describe('persona & fact boundary', () => {
    it('rejects a mention of another member as PERSONA_REVIEW_UNCERTAIN', () => {
      expectRejected(
        { quick_reply: '欢迎主播B来到直播间', cues: ['一', '二'] },
        'PERSONA_REVIEW_UNCERTAIN',
      );
    });

    it('allows a mention of the current member', () => {
      const result = validator.validate(
        { quick_reply: '我是主播A', cues: ['一', '二'] },
        makeContext(),
      );
      expect(result.ok).toBe(true);
    });

    it('rejects a forbidden promise term', () => {
      expectRejected(
        { quick_reply: '买了保证返利给你', cues: ['一', '二'] },
        'PERSONA_REVIEW_UNCERTAIN',
      );
    });

    it('fails closed when the member list is empty', () => {
      expectRejected(VALID, 'PERSONA_REVIEW_UNCERTAIN', { memberNames: [] });
    });

    it('fails closed when the current persona is unknown', () => {
      expectRejected(VALID, 'PERSONA_REVIEW_UNCERTAIN', { currentPersonaId: 'p-99' });
    });
  });

  describe('freshness & cancellation', () => {
    it('returns STALE_WINDOW on window version mismatch', () => {
      const result = validator.validate(
        VALID,
        makeContext({ actual: { sessionId: 's1', traceId: 't1', windowVersion: 2 } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok && result.kind === 'STALE') expect(result.traceReason).toBe('STALE_WINDOW');
    });

    it('returns STALE_SESSION on session mismatch', () => {
      const result = validator.validate(
        VALID,
        makeContext({ actual: { sessionId: 's2', traceId: 't1', windowVersion: 1 } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok && result.kind === 'STALE') expect(result.traceReason).toBe('STALE_SESSION');
    });

    it('returns STALE_SESSION on trace mismatch', () => {
      const result = validator.validate(
        VALID,
        makeContext({ actual: { sessionId: 's1', traceId: 't2', windowVersion: 1 } }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok && result.kind === 'STALE') expect(result.traceReason).toBe('STALE_SESSION');
    });

    it('returns DEADLINE_EXCEEDED past the freshness deadline', () => {
      const result = validator.validate(VALID, makeContext({ nowMonotonicMs: 20000 }));
      expect(result.ok).toBe(false);
      if (!result.ok && result.kind === 'STALE') {
        expect(result.traceReason).toBe('DEADLINE_EXCEEDED');
      }
    });

    it('returns USER_STOPPED when the abort signal has fired', () => {
      const controller = new AbortController();
      controller.abort();
      const result = validator.validate(VALID, makeContext({ abortSignal: controller.signal }));
      expect(result.ok).toBe(false);
      if (!result.ok && result.kind === 'STALE') expect(result.traceReason).toBe('USER_STOPPED');
    });
  });
});
