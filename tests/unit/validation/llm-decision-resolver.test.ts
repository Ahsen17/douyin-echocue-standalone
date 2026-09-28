import { describe, it, expect } from 'vitest';
import { resolveLlmDecision } from '../../../src/main/validation/index.js';
import type { SuggestionDecisionV2 } from '@echocue/contracts';

describe('resolveLlmDecision', () => {
  it('rejects when the model outputs action:reject with a discard-type semantic_type', () => {
    const output: SuggestionDecisionV2 = { action: 'reject', semantic_type: 'low_value' };
    const decision = resolveLlmDecision(output);
    expect(decision).toEqual({
      kind: 'reject',
      traceReason: 'LLM_SEMANTIC_DISCARD',
      semanticType: 'low_value',
    });
  });

  it('rejects action:reject even when semantic_type is filter_risk', () => {
    const output: SuggestionDecisionV2 = { action: 'reject', semantic_type: 'filter_risk' };
    const decision = resolveLlmDecision(output);
    expect(decision.kind).toBe('reject');
    if (decision.kind === 'reject') expect(decision.semanticType).toBe('filter_risk');
  });

  it('fail-safe: rejects action:reject even when semantic_type is a positive type', () => {
    const output: SuggestionDecisionV2 = { action: 'reject', semantic_type: 'positive_praise' };
    const decision = resolveLlmDecision(output);
    expect(decision).toEqual({
      kind: 'reject',
      traceReason: 'LLM_SEMANTIC_DISCARD',
      semanticType: 'positive_praise',
    });
  });

  it('overrides action:generate to reject when semantic_type is low_value', () => {
    const output: SuggestionDecisionV2 = {
      action: 'generate',
      semantic_type: 'low_value',
      quick_reply: '这是一句回复',
      cues: ['提词一', '提词二'],
    };
    const decision = resolveLlmDecision(output);
    expect(decision).toEqual({
      kind: 'reject',
      traceReason: 'LLM_SEMANTIC_DISCARD',
      semanticType: 'low_value',
    });
  });

  it('overrides action:generate to reject when semantic_type is filter_risk', () => {
    const output: SuggestionDecisionV2 = {
      action: 'generate',
      semantic_type: 'filter_risk',
      quick_reply: '这是一句回复',
      cues: ['提词一', '提词二'],
    };
    const decision = resolveLlmDecision(output);
    expect(decision.kind).toBe('reject');
    if (decision.kind === 'reject') expect(decision.semanticType).toBe('filter_risk');
  });

  it.each([
    'persona_relevant',
    'positive_praise',
    'funny_joke',
    'interactive_question',
    'atmosphere_boost',
  ] as const)('passes through action:generate with positive semantic_type %s', (semanticType) => {
    const output: SuggestionDecisionV2 = {
      action: 'generate',
      semantic_type: semanticType,
      quick_reply: '这是一句回复',
      cues: ['提词一', '提词二'],
    };
    const decision = resolveLlmDecision(output);
    expect(decision).toEqual({
      kind: 'generate',
      semanticType,
      candidate: { quick_reply: '这是一句回复', cues: ['提词一', '提词二'] },
    });
  });
});
