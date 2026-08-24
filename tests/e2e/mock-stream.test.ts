import { describe, it, expect } from 'vitest';
import type { WebSocketServer } from 'ws';
import type { TraceState } from '@echocue/contracts';
import type { AuditStoreWorker } from '../../src/main/storage/index.js';
import type { RetrievalRawHit } from '../../src/main/retrieval/index.js';
import {
  buildMockStreamHarness,
  transitionTuples,
  waitForTerminal,
  type MockStreamHarness,
} from './mock-stream-harness.js';

// M7-05 模拟 E2E 实时流：headless E2E —— 真实 WebSocketServer（模拟 douyinLive）
// + 真实 AuditStoreWorker + 真实 ServiceController + 注入 mock 检索/Provider/展示
// sink。每个场景断言「对照审计链」（trace 状态转移元组）与展示/Provider 结果。

const GOLDEN_PAYLOAD = {
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
  created_at: '2026-08-23T00:00:00.000Z',
  updated_at: '2026-08-23T00:00:00.000Z',
};

function goldenHit(): RetrievalRawHit {
  return {
    pointId: 'golden-1',
    caseId: 'golden-1',
    collection: 'golden_set',
    rawScore: 10,
    rank: 1,
    payload: GOLDEN_PAYLOAD,
  };
}

function preHit(): RetrievalRawHit {
  return {
    pointId: 'pre-1',
    caseId: 'pre-1',
    collection: 'pre_set',
    rawScore: 10,
    rank: 1,
    payload: {
      schema_version: '1.0',
      case_id: 'pre-1',
      tokenizer_version: 'zh_jieba_search_v1',
      text: '主播今天好可爱',
      semantic_type: 'positive_praise',
      description: '夸赞主播外形',
      enabled: true,
      is_bad_case: false,
    } as never,
  };
}

async function waitForTraces(
  h: MockStreamHarness,
  count: number,
  timeoutMs = 5000,
): Promise<Array<{ traceId: string }>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ids = h.traceIds();
    if (ids.length >= count) return ids;
    if (Date.now() > deadline) {
      throw new Error(`expected ${count} traces, got ${ids.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForTraceState(
  worker: AuditStoreWorker,
  traceId: string,
  state: TraceState,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const workflow = worker.getTraceWorkflowV1(traceId);
    const reached = workflow?.transitions.some((t) => t.toState === state) ?? false;
    if (reached) return;
    if (Date.now() > deadline) throw new Error(`trace ${traceId} did not reach ${state}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForClientsClosed(server: WebSocketServer, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (server.clients.size === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`expected the ws client to close, still ${server.clients.size} connected`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('M7-05 模拟 E2E 实时流 (A-02～A-08)', () => {
  it('filters a forbidden comment and writes the FILTERED audit chain (A-03)', async () => {
    const h = await buildMockStreamHarness({
      compiledRules: [{ ruleType: 'KEYWORD', category: 'TEAM_FORBIDDEN', text: '加微信' }],
    });
    try {
      await h.startService();
      h.sendComment('主播加微信多少', 'msg-filter');
      const [trace] = await waitForTraces(h, 1);
      const workflow = await waitForTerminal(h.worker, trace.traceId);
      expect(transitionTuples(workflow)).toEqual([
        [null, 'RECEIVED', 'EVENT_RECEIVED'],
        ['RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK'],
        ['NORMALIZED', 'FILTERED', 'INPUT_SAFETY_FILTERED'],
      ]);
      expect(h.shown).toHaveLength(0);
      expect(h.providerCalls.count).toBe(0);
    } finally {
      await h.close();
    }
  });

  it('direct-pushes a high-confidence golden hit with zero provider calls (A-05)', async () => {
    const h = await buildMockStreamHarness({ hits: [goldenHit()], displayDurationMs: 60 });
    try {
      await h.startService();
      h.sendComment('今天状态真好', 'msg-direct');
      const [trace] = await waitForTraces(h, 1);
      const workflow = await waitForTerminal(h.worker, trace.traceId);
      expect(transitionTuples(workflow)).toEqual([
        [null, 'RECEIVED', 'EVENT_RECEIVED'],
        ['RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK'],
        ['NORMALIZED', 'ROUTED', 'PERSONA_ROUTED'],
        ['ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED'],
        ['RETRIEVING', 'DIRECT_READY', 'GOLDEN_DIRECT_ELIGIBLE'],
        ['DIRECT_READY', 'DISPLAY_READY', 'OUTPUT_VALIDATED'],
        ['DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED'],
        ['DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED'],
      ]);
      expect(h.shown).toHaveLength(1);
      expect(h.providerCalls.count).toBe(0);
    } finally {
      await h.close();
    }
  });

  it('runs the single-LLM path for a pre_set top1 and displays (A-06)', async () => {
    const h = await buildMockStreamHarness({ hits: [preHit()], displayDurationMs: 60 });
    try {
      await h.startService();
      h.sendComment('主播今天好可爱', 'msg-llm');
      const [trace] = await waitForTraces(h, 1);
      const workflow = await waitForTerminal(h.worker, trace.traceId);
      expect(transitionTuples(workflow)).toEqual([
        [null, 'RECEIVED', 'EVENT_RECEIVED'],
        ['RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK'],
        ['NORMALIZED', 'ROUTED', 'PERSONA_ROUTED'],
        ['ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED'],
        ['RETRIEVING', 'PROMPT_RENDERED', 'LLM_REQUIRED'],
        ['PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED'],
        ['LLM_PENDING', 'GENERATED', 'PROVIDER_SUCCEEDED'],
        ['GENERATED', 'DISPLAY_READY', 'OUTPUT_VALIDATED'],
        ['DISPLAY_READY', 'DISPLAYED', 'OVERLAY_RENDERED'],
        ['DISPLAYED', 'HIDDEN', 'DISPLAY_DURATION_ELAPSED'],
      ]);
      expect(h.shown).toHaveLength(1);
      expect(h.providerCalls.count).toBe(1);
    } finally {
      await h.close();
    }
  });

  it('drops a candidate that outlives its freshness deadline (A-06)', async () => {
    const h = await buildMockStreamHarness({
      hits: [preHit()],
      providerDelayMs: 400,
      // 250ms freshness window: the mock retrieval+prompt complete in a few ms,
      // while the 400ms provider delay reliably exceeds it, so the
      // DEADLINE_EXCEEDED discard deterministically lands at LLM_PENDING. Kept
      // well under the provider delay with headroom for slow CI runners (150ms
      // occasionally discarded before the provider call under parallel load).
      windowMaxAgeMs: 250,
    });
    try {
      await h.startService();
      h.sendComment('主播今天好可爱', 'msg-expiry');
      const [trace] = await waitForTraces(h, 1);
      const workflow = await waitForTerminal(h.worker, trace.traceId);
      expect(transitionTuples(workflow)).toEqual([
        [null, 'RECEIVED', 'EVENT_RECEIVED'],
        ['RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK'],
        ['NORMALIZED', 'ROUTED', 'PERSONA_ROUTED'],
        ['ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED'],
        ['RETRIEVING', 'PROMPT_RENDERED', 'LLM_REQUIRED'],
        ['PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED'],
        ['LLM_PENDING', 'DISCARDED', 'DEADLINE_EXCEEDED'],
      ]);
      expect(h.shown).toHaveLength(0);
      expect(h.providerCalls.count).toBe(1);
    } finally {
      await h.close();
    }
  });

  it('suppresses generation while a display window is active (A-06)', async () => {
    const h = await buildMockStreamHarness({ hits: [goldenHit()], displayDurationMs: 500 });
    try {
      await h.startService();
      h.sendComment('今天状态真好', 'msg-first');
      const [first] = await waitForTraces(h, 1);
      await waitForTraceState(h.worker, first.traceId, 'DISPLAYED');
      h.sendComment('窗口内的第二句', 'msg-second');
      const traces = await waitForTraces(h, 2);
      const second = traces.find((t) => t.traceId !== first.traceId)!;
      const secondWf = await waitForTerminal(h.worker, second.traceId);
      expect(transitionTuples(secondWf)).toEqual([
        [null, 'RECEIVED', 'EVENT_RECEIVED'],
        ['RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK'],
        ['NORMALIZED', 'DISCARDED', 'DISPLAY_WINDOW_ACTIVE'],
      ]);
      const firstWf = await waitForTerminal(h.worker, first.traceId);
      expect(firstWf.transitions.at(-1)).toMatchObject({
        toState: 'HIDDEN',
        reasonCode: 'DISPLAY_DURATION_ELAPSED',
      });
      expect(h.shown).toHaveLength(1);
      expect(h.providerCalls.count).toBe(0);
    } finally {
      await h.close();
    }
  });

  it('drops a duplicate of the currently-displayed message without stopping (boundary)', async () => {
    const h = await buildMockStreamHarness({ hits: [goldenHit()], displayDurationMs: 500 });
    try {
      await h.startService();
      h.sendComment('今天状态真好', 'msg-display-dup');
      const [first] = await waitForTraces(h, 1);
      await waitForTraceState(h.worker, first.traceId, 'DISPLAYED');
      h.sendComment('今天状态真好', 'msg-display-dup');
      await new Promise((resolve) => setTimeout(resolve, 200));
      // audit_trace UNIQUE(session_id, source_message_id): a duplicate of the
      // displayed message is dropped — never a second row, never an
      // audit-outage stop.
      expect(h.traceIds()).toHaveLength(1);
      expect(h.machine.getViewState().lifecycle).toBe('RUNNING');
      expect(h.shown).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  it('drops a re-send of a display-suppressed message after the window ends (boundary)', async () => {
    const h = await buildMockStreamHarness({ hits: [goldenHit()], displayDurationMs: 300 });
    try {
      await h.startService();
      h.sendComment('今天状态真好', 'msg-a');
      const [a] = await waitForTraces(h, 1);
      await waitForTraceState(h.worker, a.traceId, 'DISPLAYED');
      // A new message during the display window is audited DISPLAY_WINDOW_ACTIVE.
      h.sendComment('窗口内的消息', 'msg-b');
      const traces = await waitForTraces(h, 2);
      const b = traces.find((t) => t.traceId !== a.traceId)!;
      await waitForTerminal(h.worker, b.traceId);
      // After the window ends (msg-a HIDDEN), the suppressed message is re-sent:
      // it is in the session dedup set, so it is dropped — not a second trace
      // and not an audit-outage stop.
      await waitForTerminal(h.worker, a.traceId);
      h.sendComment('窗口内的消息', 'msg-b');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(h.traceIds()).toHaveLength(2);
      expect(h.machine.getViewState().lifecycle).toBe('RUNNING');
    } finally {
      await h.close();
    }
  });

  it('stops mid-LLM, closes the in-flight trace as USER_STOPPED and cleans up (A-02/A-07)', async () => {
    const h = await buildMockStreamHarness({ hits: [preHit()], providerDelayMs: 3000 });
    try {
      await h.startService();
      h.sendComment('主播今天好可爱', 'msg-stop');
      const [trace] = await waitForTraces(h, 1);
      await waitForTraceState(h.worker, trace.traceId, 'LLM_PENDING');
      const state = await h.stop();
      expect(state.lifecycle).toBe('STOPPED');
      expect(state.stopReason).toBe('USER_STOP');
      const workflow = await waitForTerminal(h.worker, trace.traceId);
      expect(transitionTuples(workflow)).toEqual([
        [null, 'RECEIVED', 'EVENT_RECEIVED'],
        ['RECEIVED', 'NORMALIZED', 'NORMALIZATION_OK'],
        ['NORMALIZED', 'ROUTED', 'PERSONA_ROUTED'],
        ['ROUTED', 'RETRIEVING', 'RETRIEVAL_STARTED'],
        ['RETRIEVING', 'PROMPT_RENDERED', 'LLM_REQUIRED'],
        ['PROMPT_RENDERED', 'LLM_PENDING', 'PROVIDER_REQUESTED'],
        ['LLM_PENDING', 'DISCARDED', 'USER_STOPPED'],
      ]);
      expect(h.shown).toHaveLength(0);
      expect(h.sidecar.started).toBe(false);
      await waitForClientsClosed(h.server);
    } finally {
      await h.close();
    }
  });

  it('stops the service with AUDIT_UNAVAILABLE when an audit write fails mid-session (A-07)', async () => {
    const h = await buildMockStreamHarness();
    try {
      await h.startService();
      h.worker.close();
      h.sendComment('主播晚上好', 'msg-audit');
      const deadline = Date.now() + 5000;
      let state = h.machine.getViewState();
      while (state.lifecycle !== 'STOPPED') {
        if (Date.now() > deadline) {
          throw new Error(`service did not stop on audit failure (lifecycle=${state.lifecycle})`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        state = h.machine.getViewState();
      }
      expect(state.stopReason).toBe('AUDIT_UNAVAILABLE');
      expect(h.traceIds()).toHaveLength(0);
    } finally {
      await h.close();
    }
  });

  it('drops a session-duplicate message silently with no second trace (boundary)', async () => {
    const h = await buildMockStreamHarness({
      compiledRules: [{ ruleType: 'KEYWORD', category: 'TEAM_FORBIDDEN', text: '加微信' }],
    });
    try {
      await h.startService();
      h.sendComment('主播加微信多少', 'msg-dup');
      const [first] = await waitForTraces(h, 1);
      await waitForTerminal(h.worker, first.traceId);
      h.sendComment('主播加微信多少', 'msg-dup');
      await new Promise((resolve) => setTimeout(resolve, 200));
      // audit_trace UNIQUE(session_id, source_message_id): the duplicate frame
      // never gets a second row; the first occurrence is already audited.
      expect(h.traceIds()).toHaveLength(1);
      expect(h.shown).toHaveLength(0);
      expect(h.providerCalls.count).toBe(0);
    } finally {
      await h.close();
    }
  });

  it('ignores gift/like frames without creating a trace (T-CON boundary)', async () => {
    const h = await buildMockStreamHarness();
    try {
      await h.startService();
      h.sendFrame({ method: 'WebcastGiftMessage', common: { msgId: 'gift-1' }, content: '礼物' });
      h.sendFrame({ method: 'WebcastLikeMessage', common: { msgId: 'like-1' }, content: '' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(h.traceIds()).toHaveLength(0);
      expect(h.shown).toHaveLength(0);
      expect(h.providerCalls.count).toBe(0);
    } finally {
      await h.close();
    }
  });

  it('records monotonic e2e latency through OVERLAY_RESULT (T-PERF-001)', async () => {
    const h = await buildMockStreamHarness({ hits: [goldenHit()], displayDurationMs: 40 });
    try {
      await h.startService();
      const e2eSamples: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        h.sendComment(`状态真好${i}`, `msg-perf-${i}`);
        const traces = await waitForTraces(h, i + 1);
        const workflow = await waitForTerminal(h.worker, traces[i].traceId);
        const overlay = workflow.transitions
          .flatMap((t) => t.snapshots)
          .find((s) => s.role === 'OVERLAY_RESULT');
        expect(overlay).toBeDefined();
        const payload = JSON.parse(overlay!.plaintext) as { e2eMs: number };
        expect(payload.e2eMs).toBeGreaterThan(0);
        e2eSamples.push(payload.e2eMs);
      }
      const sorted = [...e2eSamples].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
      // Generous synthetic ceiling only; the real-room 3s SLO is M7-06's POC.
      expect(p95).toBeLessThan(1000);
    } finally {
      await h.close();
    }
  });
});
