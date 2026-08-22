import { describe, expect, it } from 'vitest';
import type {
  GoldenSetPayloadV1,
  OverlayDisplayPayloadV1,
  SourceComment,
  TraceState,
  ValidatedSuggestionV1,
} from '@echocue/contracts';
import { TRACE_TRANSITIONS_V1 } from '@echocue/contracts';
import { ServiceStateMachine } from '../../../src/main/service/index.js';
import { SuggestionAttemptOrchestrator } from '../../../src/main/suggestion/index.js';
import type { SuggestionOrchestratorDeps } from '../../../src/main/suggestion/index.js';
import { SuggestionOutputValidator } from '../../../src/main/validation/index.js';
import { AuditUnavailableError } from '../../../src/main/storage/index.js';
import type { RetrievalRawHit } from '../../../src/main/retrieval/index.js';

/** In-memory audit recorder that enforces TRACE_TRANSITIONS_V1 like the worker. */
class FakeAudit {
  traces: Array<{ traceId: string; sessionId: string }> = [];
  transitions: Array<{ traceId: string; from: string | null; to: string; reason: string }> = [];
  snapshots: Array<{ traceId: string; to: string; role: string; payload: unknown }> = [];
  failWrites = false;

  createTrace(p: { traceId: string; sessionId: string }): void {
    this.assertWritable();
    this.traces.push(p);
  }
  createSession(): void {}
  appendTransition(
    traceId: string,
    from: string | null,
    to: string,
    reason: string,
    snapshots: ReadonlyArray<{ role: string; plaintext: Buffer }> = [],
  ): void {
    this.assertWritable();
    const allowed = (TRACE_TRANSITIONS_V1 as Record<string, readonly string[]>)[from ?? 'INITIAL'];
    if (!allowed || !allowed.includes(to as never)) {
      throw new Error(`E_AUDIT_STATE_INVALID: ${from ?? 'INITIAL'} -> ${to}`);
    }
    this.transitions.push({ traceId, from, to, reason });
    for (const snap of snapshots) {
      this.snapshots.push({ traceId, to, role: snap.role, payload: JSON.parse(snap.plaintext.toString()) });
    }
  }
  healthCheck(): boolean {
    return !this.failWrites;
  }
  private assertWritable(): void {
    if (this.failWrites) throw new AuditUnavailableError('db unavailable');
  }
}

const GOLDEN_PAYLOAD: GoldenSetPayloadV1 = {
  case_id: 'golden-1',
  tokenizer_version: 'zh_jieba_search_v1',
  source_trace_id: '01932a3b-4c5d-7000-8000-000000000001',
  persona_id: 'p-1',
  persona_version: 'v-1',
  text: '今天状态真好',
  semantic_type: 'positive_praise',
  reply: '谢谢你！',
  cues: ['接住夸奖', '继续互动'],
  quality_score: 90,
  enabled: true,
  is_bad_case: false,
  created_at: '2026-08-22T00:00:00.000Z',
  updated_at: '2026-08-22T00:00:00.000Z',
};

const PRE_PAYLOAD = {
  schema_version: '1.0',
  case_id: 'pre-1',
  tokenizer_version: 'zh_jieba_search_v1',
  text: '主播今天好可爱',
  semantic_type: 'positive_praise',
  description: '夸赞主播外形',
  enabled: true,
  is_bad_case: false,
};

function goldenHit(confidence: number): RetrievalRawHit {
  return {
    pointId: 'golden-1',
    caseId: 'golden-1',
    collection: 'golden_set',
    rawScore: 10,
    rank: 1,
    payload: GOLDEN_PAYLOAD,
  };
}

function preHit(confidence: number): RetrievalRawHit {
  return {
    pointId: 'pre-1',
    caseId: 'pre-1',
    collection: 'pre_set',
    rawScore: 10,
    rank: 1,
    payload: PRE_PAYLOAD as never,
  };
}

function makeRetriever(hits: RetrievalRawHit[]) {
  return {
    search: async () => ({
      goldenHits: hits.filter((h) => h.collection === 'golden_set'),
      preHits: hits.filter((h) => h.collection === 'pre_set'),
    }),
  };
}

interface FakeProvider {
  calls: number;
  result:
    | { ok: true; output: { quick_reply: string; cues: string[] } }
    | { ok: false; error: { code: string } };
}

function makeProvider(result?: FakeProvider['result']): FakeProvider & TextGenerationProviderLike {
  const provider: FakeProvider & TextGenerationProviderLike = {
    calls: 0,
    result: result ?? { ok: true, output: { quick_reply: '谢谢你', cues: ['一', '二'] } },
    adapterType: 'OPENAI_COMPATIBLE',
    async generateReply() {
      provider.calls += 1;
      return provider.result;
    },
    getAuditRecord() {
      return null;
    },
  };
  return provider;
}

interface TextGenerationProviderLike {
  adapterType: string;
  generateReply(input: unknown): Promise<FakeProvider['result']>;
  getAuditRecord(): unknown;
}

function makeSink() {
  const shown: OverlayDisplayPayloadV1[] = [];
  return {
    shown,
    async show(payload: OverlayDisplayPayloadV1) {
      shown.push(payload);
      return { ok: true, firstFrameAtMonotonicMs: 100 };
    },
    async hide() {},
  };
}

function makeComment(overrides: Partial<SourceComment> = {}): SourceComment {
  return {
    sourceMessageId: 'msg-1',
    rawEvent: { method: 'WebcastChatMessage' },
    rawText: '主播晚上好',
    normalizedText: '主播晚上好',
    userNickname: '观众A',
    receivedAt: '2026-08-22T00:00:00.000Z',
    receivedMonotonicMs: 1000,
    ...overrides,
  };
}

function runMachine(machine: ServiceStateMachine): void {
  machine.transitionToLifecycle('GATE_CONNECTING');
  machine.transitionToLifecycle('RUNNING');
}

function harness(overrides: Partial<SuggestionOrchestratorDeps> = {}) {
  const audit = new FakeAudit();
  const machine = new ServiceStateMachine();
  runMachine(machine);
  const sink = makeSink();
  const deps: SuggestionOrchestratorDeps = {
    audit: audit as never,
    stateMachine: machine,
    router: {
      route: () => ({
        personaId: 'p-1',
        personaVersion: 'v-1',
        personaMarkdown: '你是一个温柔的主播。',
        decision: 'principal_fallback',
        candidates: [],
      }),
    } as never,
    personas: {
      listPersonas: () => [
        { personaId: 'p-1', displayName: '主播A', isPrincipal: true, aliases: ['阿A'] },
      ],
      listAliases: () => [{ aliasText: '阿A', aliasKind: 'display', enabled: true }],
      getVersionMeta: () => ({ contentHmac: 'hmac-v1' }),
    } as never,
    safety: {
      getActivePublishedVersion: async () => 'pol-v1',
      readPolicy: () => ({
        policyText: '不讨论医疗金融政治。',
        keywords: ['加微信'],
        compiledRules: [{ ruleType: 'KEYWORD', category: 'TEAM_FORBIDDEN', text: '加微信' }],
        validationErrors: null,
      }),
    } as never,
    retriever: makeRetriever([]) as never,
    providerConfig: {
      getProviderConfig: async () => ({
        providerId: 'compat-backup',
        displayName: '备用',
        adapterType: 'OPENAI_COMPATIBLE',
        baseUrl: 'https://llm.example.invalid/v1',
        modelId: 'm',
        credentialRef: 'safe-storage:compat-backup',
      }),
    } as never,
    credentials: { getCredential: async () => 'sk-test' } as never,
    createProvider: () => makeProvider() as never,
    validator: new SuggestionOutputValidator(),
    displaySink: sink,
    // Comment deadline = receivedMonotonicMs(1000) + 3000 = 4000; keep the clock
    // below it so candidates stay fresh through retrieval and generation.
    nowMonotonic: () => 2000,
    windowMaxAgeMs: 100000,
    candidateMaxCount: 50,
    directPushThreshold: 0.85,
    onAuditFailure: () => {},
    ...overrides,
  };
  const orchestrator = new SuggestionAttemptOrchestrator(deps);
  return { audit, machine, sink, orchestrator, deps };
}

async function flush(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe('SuggestionAttemptOrchestrator', () => {
  it('routes and audits a safe comment chain', async () => {
    const { audit, orchestrator } = harness();
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment());
    await flush();
    const reasons = audit.transitions.map((t) => t.reason);
    expect(reasons).toContain('EVENT_RECEIVED');
    expect(reasons).toContain('NORMALIZATION_OK');
    expect(reasons).toContain('PERSONA_ROUTED');
  });

  it('discards a comment during DISPLAYING without retrieval or generation', async () => {
    const { audit, machine, orchestrator } = harness();
    await orchestrator.startSession({ sessionId: 's1' });
    // Valid path to DISPLAYING: LISTENING → RETRIEVING → GENERATING → DISPLAYING.
    machine.setActivity('RETRIEVING');
    machine.setActivity('GENERATING');
    machine.setActivity('DISPLAYING');
    orchestrator.handleComment(makeComment());
    const reasons = audit.transitions.map((t) => t.reason);
    expect(reasons).toContain('DISPLAY_WINDOW_ACTIVE');
    expect(reasons).not.toContain('PERSONA_ROUTED');
  });

  it('filters an unsafe comment as INPUT_SAFETY_FILTERED', async () => {
    const { audit, orchestrator } = harness();
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment({ normalizedText: '想加微信私聊' }));
    const reasons = audit.transitions.map((t) => t.reason);
    expect(reasons).toContain('INPUT_SAFETY_FILTERED');
  });

  it('feeds the diagnostics hooks from the real-time path (display)', async () => {
    const received: number[] = [];
    const results: Array<[string, number | undefined]> = [];
    const { orchestrator } = harness({
      retriever: makeRetriever([goldenHit(0.98)]) as never,
      displaySink: {
        show: async () => ({ ok: true, firstFrameAtMonotonicMs: 2000 }),
        hide: async () => {},
      } as never,
      onCommentReceived: () => received.push(received.length),
      onSuggestionResult: (result, e2e) => results.push([result, e2e]),
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment());
    await waitFor(() => results.length > 0);
    expect(received.length).toBe(1);
    expect(results[0][0]).toBe('displayed');
    expect(results[0][1]).toBe(1000);
  });

  it('feeds the filtered outcome when input safety filters', async () => {
    const received: number[] = [];
    const results: string[] = [];
    const { orchestrator } = harness({
      onCommentReceived: () => received.push(received.length),
      onSuggestionResult: (result) => results.push(result),
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment({ normalizedText: '想加微信私聊' }));
    await flush();
    expect(received.length).toBe(1);
    expect(results).toContain('filtered');
  });

  it('dedups repeated source_message_id within a session', async () => {
    const { audit, orchestrator } = harness();
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment());
    orchestrator.handleComment(makeComment());
    const lowValue = audit.transitions.filter((t) => t.reason === 'LOW_VALUE');
    expect(lowValue.length).toBe(1);
  });

  it('takes the golden direct path with zero provider calls', async () => {
    const provider = makeProvider();
    const { audit, orchestrator, sink } = harness({
      retriever: makeRetriever([goldenHit(0.98)]) as never,
      createProvider: () => provider as never,
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment());
    await flush();
    expect(provider.calls).toBe(0);
    expect(audit.transitions.map((t) => t.to)).toContain('DIRECT_READY');
    expect(audit.transitions.map((t) => t.to)).toContain('DISPLAY_READY');
    expect(sink.shown.length).toBe(1);
  });

  it('falls back to the LLM path for a pre_set top1 with exactly one provider call', async () => {
    const provider = makeProvider();
    const { audit, orchestrator } = harness({
      retriever: makeRetriever([preHit(0.9)]) as never,
      createProvider: () => provider as never,
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment());
    await flush();
    expect(provider.calls).toBe(1);
    expect(audit.transitions.map((t) => t.to)).toContain('PROMPT_RENDERED');
    expect(audit.transitions.map((t) => t.to)).toContain('DISPLAY_READY');
  });

  it('aborts the in-flight attempt on abortAll(USER_STOP)', async () => {
    const provider = makeProvider({ ok: false, error: { code: 'ABORTED' } });
    const { audit, orchestrator } = harness({
      retriever: makeRetriever([preHit(0.9)]) as never,
      createProvider: () => provider as never,
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment());
    await flush(5);
    orchestrator.abortAll('USER_STOP');
    await flush(10);
    expect(audit.transitions.some((t) => t.reason === 'USER_STOPPED')).toBe(true);
  });

  it('closes a retrieval failure from RETRIEVING (legal transition)', async () => {
    const { audit, orchestrator } = harness({
      retriever: {
        search: async () => {
          throw new Error('qdrant down');
        },
      } as never,
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment());
    await flush();
    const discard = audit.transitions.find((t) => t.to === 'DISCARDED');
    expect(discard).toBeDefined();
    expect(discard?.from).toBe('RETRIEVING');
  });

  it('fails LLM_PENDING → FAILED when provider config is missing', async () => {
    const { audit, orchestrator } = harness({
      retriever: makeRetriever([preHit(0.9)]) as never,
      providerConfig: { getProviderConfig: async () => null } as never,
      credentials: { getCredential: async () => 'sk' } as never,
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment());
    await flush();
    const failed = audit.transitions.find((t) => t.to === 'FAILED');
    expect(failed).toBeDefined();
    expect(failed?.from).toBe('LLM_PENDING');
  });

  it('does not throw when a new comment arrives during GENERATING', async () => {
    const provider = makeProvider();
    const { orchestrator } = harness({
      retriever: makeRetriever([preHit(0.9)]) as never,
      createProvider: () => provider as never,
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment({ sourceMessageId: 'msg-1' }));
    // While the first attempt is generating, a second comment arrives.
    await flush(5);
    orchestrator.handleComment(makeComment({ sourceMessageId: 'msg-2' }));
    await flush();
    expect(provider.calls).toBeGreaterThanOrEqual(1);
  });

  it('releases the mutex when the deadline passes mid-LLM (no deadlock)', async () => {
    let now = 2000;
    const provider = makeProvider();
    let releaseGeneration: () => void = () => {};
    const { audit, orchestrator } = harness({
      retriever: makeRetriever([preHit(0.9)]) as never,
      createProvider: () =>
        ({
          adapterType: 'OPENAI_COMPATIBLE',
          async generateReply() {
            await new Promise<void>((resolve) => {
              releaseGeneration = resolve;
            });
            return { ok: true, output: { quick_reply: '谢谢你', cues: ['一', '二'] } };
          },
          getAuditRecord: () => null,
        }) as never,
      nowMonotonic: () => now,
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment());
    await waitFor(() => orchestrator.getCurrentAttempt() !== null);
    // Advance past the freshness deadline while the provider call is in flight.
    now = 5000;
    releaseGeneration();
    // The stale attempt must be discarded (not left in-flight forever).
    await waitFor(() => orchestrator.getCurrentAttempt() === null);
    expect(audit.transitions.some((t) => t.to === 'DISCARDED')).toBe(true);
  });

  it('stop mid-LLM does not corrupt the audit chain (CRITICAL-1)', async () => {
    const provider = makeProvider();
    const { audit, orchestrator } = harness({
      retriever: makeRetriever([preHit(0.9)]) as never,
      createProvider: () => provider as never,
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment());
    // Stop while the LLM call is in flight: cleanupOnStop runs abortAll +
    // endSession synchronously; the provider continuation resolves afterwards.
    orchestrator.abortAll('USER_STOP');
    orchestrator.endSession();
    await flush();
    // The chain must close from a real pre-stop state, never RECEIVED→NORMALIZED
    // appended after LLM_PENDING (that would corrupt the hash chain).
    const chain = audit.transitions.map((t) => `${t.from ?? 'INITIAL'}->${t.to}`);
    const iLlm = chain.indexOf('LLM_PENDING->GENERATED');
    const iRec = chain.indexOf('RECEIVED->NORMALIZED');
    if (iLlm !== -1) {
      // If the chain reached LLM_PENDING before the stop, nothing after it may
      // reopen RECEIVED (RECEIVED only follows INITIAL).
      expect(iRec).toBeLessThan(iLlm);
    }
    // Every transition pair must be legal (FakeAudit enforces this already).
  });

  it('stop does not start a fresh attempt from a windowed candidate (MAJOR-A)', async () => {
    const provider = makeProvider();
    let releaseProvider: () => void = () => {};
    const gatedProvider = {
      adapterType: 'OPENAI_COMPATIBLE',
      async generateReply() {
        await new Promise<void>((resolve) => {
          releaseProvider = resolve;
        });
        return { ok: false, error: { code: 'PROTOCOL' } };
      },
      getAuditRecord: () => null,
    };
    const { audit, orchestrator } = harness({
      retriever: makeRetriever([preHit(0.9)]) as never,
      createProvider: () => gatedProvider as never,
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment({ sourceMessageId: 'msg-1' }));
    await waitFor(() => orchestrator.getCurrentAttempt()?.comment.sourceMessageId === 'msg-1');
    // A second candidate is windowed before the stop.
    orchestrator.handleComment(makeComment({ sourceMessageId: 'msg-2' }));
    await waitFor(() => audit.transitions.some((t) => t.to === 'RETRIEVING'));
    const beforeStop = audit.transitions.length;
    // Stop: abortAll must not start msg-2 as a new attempt (MAJOR-A).
    orchestrator.abortAll('ROOM_ENDED');
    orchestrator.endSession();
    releaseProvider();
    await flush();
    const afterStop = audit.transitions.slice(beforeStop);
    // No LLM_PENDING / PROMPT_RENDERED may appear after the stop (no fresh start).
    expect(afterStop.some((t) => t.to === 'LLM_PENDING')).toBe(false);
    expect(afterStop.some((t) => t.to === 'PROMPT_RENDERED')).toBe(false);
    expect(orchestrator.getCurrentAttempt()).toBeNull();
    void provider;
  });

  it('a windowed candidate started after a prior attempt takes the LLM path legally', async () => {
    // msg-1 takes the LLM path and fails (PROTOCOL); msg-2 arrives during
    // msg-1's generation, is windowed, then starts after msg-1 clears. Starting
    // from LISTENING must hop LISTENING→RETRIEVING→GENERATING (not throw).
    const provider = makeProvider({ ok: false, error: { code: 'PROTOCOL' } });
    let releaseProvider: () => void = () => {};
    const gatedProvider = {
      adapterType: 'OPENAI_COMPATIBLE',
      async generateReply() {
        await new Promise<void>((resolve) => {
          releaseProvider = resolve;
        });
        return { ok: false, error: { code: 'PROTOCOL' } };
      },
      getAuditRecord: () => null,
    };
    const { audit, orchestrator } = harness({
      retriever: makeRetriever([preHit(0.9)]) as never,
      createProvider: () => gatedProvider as never,
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment({ sourceMessageId: 'msg-1' }));
    await waitFor(() => orchestrator.getCurrentAttempt()?.comment.sourceMessageId === 'msg-1');
    // msg-2 arrives while msg-1 is generating; windowed, not yet an attempt.
    orchestrator.handleComment(makeComment({ sourceMessageId: 'msg-2' }));
    await waitFor(() => audit.transitions.some((t) => t.to === 'RETRIEVING'));
    expect(orchestrator.getCurrentAttempt()?.comment.sourceMessageId).toBe('msg-1');
    releaseProvider();
    // msg-2 must reach LLM_PENDING as a second attempt (mutex released),
    // proving the LISTENING→…→GENERATING hop works. Under the old buggy code
    // msg-2's runAttempt would throw before LLM_PENDING, so >=2 is a strict guard.
    await waitFor(() => audit.transitions.filter((t) => t.to === 'LLM_PENDING').length >= 2);
    void provider;
  });

  it('audit failure aborts and fires onAuditFailure', async () => {
    let onAuditFailureCalls = 0;
    const audit = new FakeAudit();
    audit.failWrites = true;
    const machine = new ServiceStateMachine();
    runMachine(machine);
    const orchestrator = new SuggestionAttemptOrchestrator({
      audit: audit as never,
      stateMachine: machine,
      router: { route: () => ({ personaId: 'p-1', personaVersion: 'v-1', personaMarkdown: 'x', decision: 'principal_fallback', candidates: [] }) } as never,
      personas: {
        listPersonas: () => [],
        listAliases: () => [],
        getVersionMeta: () => ({ contentHmac: 'h' }),
      } as never,
      safety: {
        getActivePublishedVersion: async () => 'pol-v1',
        readPolicy: () => ({ policyText: '', keywords: [], compiledRules: null, validationErrors: null }),
      } as never,
      retriever: makeRetriever([]) as never,
      providerConfig: { getProviderConfig: async () => null } as never,
      credentials: { getCredential: async () => null } as never,
      createProvider: () => makeProvider() as never,
      validator: new SuggestionOutputValidator(),
      displaySink: makeSink(),
      nowMonotonic: () => 2000,
      windowMaxAgeMs: 100000,
      candidateMaxCount: 50,
      directPushThreshold: 0.85,
      onAuditFailure: () => {
        onAuditFailureCalls += 1;
      },
    });
    await orchestrator.startSession({ sessionId: 's1' });
    orchestrator.handleComment(makeComment());
    await flush();
    expect(onAuditFailureCalls).toBe(1);
    expect(orchestrator.getCurrentAttempt()).toBeNull();
  });

  describe('M5-08 deadline / clock / display timer', () => {
    function gatedProvider() {
      let releaseGeneration: () => void = () => {};
      const provider = {
        adapterType: 'OPENAI_COMPATIBLE',
        async generateReply() {
          await new Promise<void>((resolve) => {
            releaseGeneration = resolve;
          });
          return { ok: true, output: { quick_reply: '谢谢你', cues: ['一', '二'] } };
        },
        getAuditRecord: () => null,
      };
      return { provider, release: () => releaseGeneration() };
    }

    it('applies the t0 cap when windowMaxAge is large and selection is immediate', async () => {
      const { release } = gatedProvider();
      let now = 2000;
      const { orchestrator } = harness({
        retriever: makeRetriever([preHit(0.9)]) as never,
        windowMaxAgeMs: 100000,
        nowMonotonic: () => now,
        createProvider: () => gatedProvider().provider as never,
      });
      await orchestrator.startSession({ sessionId: 's1' });
      orchestrator.handleComment(makeComment({ receivedMonotonicMs: 1000 }));
      await waitFor(() => orchestrator.getCurrentAttempt() !== null);
      // min(t0+3000, selectedAt+2500, t0+windowMaxAge) = min(4000, 4500, 101000) = 4000.
      expect(orchestrator.getCurrentAttempt()!.freshnessDeadlineMonotonicMs).toBe(4000);
      release();
    });

    it('lets the selection budget bind when the candidate waited in the window', async () => {
      let now = 1200;
      const { orchestrator } = harness({
        retriever: makeRetriever([preHit(0.9)]) as never,
        windowMaxAgeMs: 100000,
        nowMonotonic: () => now,
        createProvider: () => gatedProvider().provider as never,
      });
      await orchestrator.startSession({ sessionId: 's1' });
      orchestrator.handleComment(makeComment({ receivedMonotonicMs: 1000 }));
      await waitFor(() => orchestrator.getCurrentAttempt() !== null);
      // min(1000+3000, 1200+2500, 1000+100000) = 3700 (selection budget binds).
      expect(orchestrator.getCurrentAttempt()!.freshnessDeadlineMonotonicMs).toBe(3700);
    });

    it('binds to the window residency (t0 + windowMaxAgeMs) and discards via DEADLINE_EXCEEDED', async () => {
      const { provider, release } = gatedProvider();
      let now = 2000;
      const { audit, orchestrator } = harness({
        retriever: makeRetriever([preHit(0.9)]) as never,
        windowMaxAgeMs: 1500,
        nowMonotonic: () => now,
        createProvider: () => provider as never,
      });
      await orchestrator.startSession({ sessionId: 's1' });
      orchestrator.handleComment(makeComment({ receivedMonotonicMs: 1000 }));
      await waitFor(() => orchestrator.getCurrentAttempt() !== null);
      // min(4000, 4500, 2500) = 2500: the window residency binds.
      expect(orchestrator.getCurrentAttempt()!.freshnessDeadlineMonotonicMs).toBe(2500);
      now = 2600; // past 2500 while the provider call is in flight
      release();
      await waitFor(() => orchestrator.getCurrentAttempt() === null);
      expect(audit.transitions.some((t) => t.reason === 'DEADLINE_EXCEEDED')).toBe(true);
    });

    it('auto-hides the overlay after the display duration (M5-08 timer)', async () => {
      const { audit, orchestrator, sink } = harness({
        retriever: makeRetriever([preHit(0.9)]) as never,
        displayDurationMs: 20,
      });
      await orchestrator.startSession({ sessionId: 's1' });
      orchestrator.handleComment(makeComment());
      await waitFor(() => audit.transitions.some((t) => t.to === 'DISPLAYED'));
      await waitFor(() =>
        audit.transitions.some((t) => t.to === 'HIDDEN' && t.reason === 'DISPLAY_DURATION_ELAPSED'),
      );
      expect(sink.shown.length).toBe(1);
      expect(orchestrator.getCurrentAttempt()).toBeNull();
    });

    it('reads the display duration from getDisplayDurationMs when provided (M6-06)', async () => {
      const { audit, orchestrator } = harness({
        retriever: makeRetriever([preHit(0.9)]) as never,
        getDisplayDurationMs: async () => 30,
      });
      await orchestrator.startSession({ sessionId: 's1' });
      orchestrator.handleComment(makeComment());
      await waitFor(() => audit.transitions.some((t) => t.to === 'DISPLAYED'));
      // The default (10s) would never fire within the wait; HIDDEN proves the
      // live getter value (30ms) was used for the display timer.
      await waitFor(() =>
        audit.transitions.some((t) => t.to === 'HIDDEN' && t.reason === 'DISPLAY_DURATION_ELAPSED'),
      );
    });

    it('prefers getDisplayDurationMs over the fixed displayDurationMs (M6-06)', async () => {
      const { audit, orchestrator } = harness({
        retriever: makeRetriever([preHit(0.9)]) as never,
        displayDurationMs: 20,
        getDisplayDurationMs: async () => 100000,
      });
      await orchestrator.startSession({ sessionId: 's1' });
      orchestrator.handleComment(makeComment());
      await waitFor(() => audit.transitions.some((t) => t.to === 'DISPLAYED'));
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(audit.transitions.some((t) => t.to === 'HIDDEN')).toBe(false);
    });

    it('passes the triggering comment and suggestion to the display sink (M6-07)', async () => {
      const { sink, orchestrator } = harness({
        retriever: makeRetriever([preHit(0.9)]) as never,
      });
      await orchestrator.startSession({ sessionId: 's1' });
      orchestrator.handleComment(makeComment({ userNickname: '观众B', normalizedText: '主播真棒' }));
      await waitFor(() => sink.shown.length === 1);
      expect(sink.shown[0].comment).toEqual({ nickname: '观众B', text: '主播真棒' });
      expect(sink.shown[0].suggestion.quickReply.length).toBeGreaterThan(0);
    });

    it('cancels the display timer on abort so it never fires late (M5-08)', async () => {
      let hideCalls = 0;
      const sink = {
        async show() {
          return { ok: true, firstFrameAtMonotonicMs: 100 };
        },
        async hide() {
          hideCalls += 1;
        },
      };
      const { audit, orchestrator } = harness({
        retriever: makeRetriever([preHit(0.9)]) as never,
        displaySink: sink as never,
        displayDurationMs: 30,
      });
      await orchestrator.startSession({ sessionId: 's1' });
      orchestrator.handleComment(makeComment());
      await waitFor(() => audit.transitions.some((t) => t.to === 'DISPLAYED'));
      orchestrator.abortAll('USER_STOP');
      orchestrator.endSession();
      const hideAfterStop = hideCalls;
      // Wait longer than the display duration: a stale timer would have fired
      // finishDisplay → hide() again.
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(hideCalls).toBe(hideAfterStop);
    });

    it('records t1/t2/t_end into audit snapshots (RESEARCH §6.1)', async () => {
      const { audit, orchestrator } = harness({
        retriever: makeRetriever([preHit(0.9)]) as never,
        displayDurationMs: 20,
      });
      await orchestrator.startSession({ sessionId: 's1' });
      orchestrator.handleComment(makeComment({ receivedMonotonicMs: 1000 }));
      await waitFor(() => audit.snapshots.some((s) => s.role === 'OVERLAY_RESULT'));
      const route = audit.snapshots.find((s) => s.role === 'PERSONA_ROUTE');
      const validation = audit.snapshots.find((s) => s.role === 'OUTPUT_VALIDATION');
      const overlay = audit.snapshots.find((s) => s.role === 'OVERLAY_RESULT');
      expect(route?.payload).toMatchObject({ filterCompleteAtMonotonicMs: 2000 });
      expect(validation?.payload).toMatchObject({ outputValidatedAtMonotonicMs: 2000 });
      // t_end (100) and t0 (1000) come from the stub clock; presence is the contract.
      expect(overlay?.payload).toHaveProperty('e2eMs');
    });
  });

  describe('M5-09 LLM-path audit snapshots', () => {
    it('persists the four LLM-path snapshots on an LLM attempt', async () => {
      const { audit, orchestrator } = harness({
        retriever: makeRetriever([preHit(0.9)]) as never,
        displayDurationMs: 20,
      });
      await orchestrator.startSession({ sessionId: 's1' });
      orchestrator.handleComment(makeComment());
      await waitFor(() => audit.snapshots.some((s) => s.role === 'LLM_PARSED_OUTPUT'));
      const roles = audit.snapshots.map((s) => s.role);
      expect(roles).toContain('RENDERED_PROMPT');
      expect(roles).toContain('LLM_REQUEST_META');
      expect(roles).toContain('LLM_RAW_RESPONSE');
      expect(roles).toContain('LLM_PARSED_OUTPUT');
      // No secrets / raw scores / internal thresholds inside any LLM snapshot.
      const llmSnaps = audit.snapshots.filter((s) =>
        ['RENDERED_PROMPT', 'LLM_REQUEST_META', 'LLM_RAW_RESPONSE', 'LLM_PARSED_OUTPUT'].includes(s.role),
      );
      const allPayload = JSON.stringify(llmSnaps.map((s) => s.payload));
      expect(allPayload).not.toContain('sk-test');
      expect(allPayload).not.toContain('rawScore');
      expect(allPayload).not.toContain('directPushThreshold');
      // LLM_REQUEST_META carries the request identity, not the key.
      const meta = audit.snapshots.find((s) => s.role === 'LLM_REQUEST_META');
      expect(meta?.payload).toMatchObject({ providerId: 'compat-backup', modelId: 'm' });
    });

    it('does not write LLM_RAW_RESPONSE/LLM_PARSED_OUTPUT on provider failure', async () => {
      const { audit, orchestrator } = harness({
        retriever: makeRetriever([preHit(0.9)]) as never,
        createProvider: () => makeProvider({ ok: false, error: { code: 'NETWORK' } }) as never,
      });
      await orchestrator.startSession({ sessionId: 's1' });
      orchestrator.handleComment(makeComment());
      await flush();
      const roles = audit.snapshots.map((s) => s.role);
      expect(roles).not.toContain('LLM_RAW_RESPONSE');
      expect(roles).not.toContain('LLM_PARSED_OUTPUT');
      expect(roles).toContain('FINAL_REASON');
    });
  });
});
