import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseSync } from 'node:sqlite';
import type {
  GoldenSetPayloadV1,
  OverlayDisplayPayloadV1,
  SourceComment,
} from '@echocue/contracts';
import { AuditStoreWorker } from '../../../src/main/storage/index.js';
import { CryptoKeyManager } from '../../../src/main/crypto/key-manager.js';
import { CredentialStore } from '../../../src/main/credentials/CredentialStore.js';
import { ServiceStateMachine } from '../../../src/main/service/index.js';
import { SuggestionAttemptOrchestrator } from '../../../src/main/suggestion/index.js';
import { SuggestionOutputValidator } from '../../../src/main/validation/index.js';
import type { SuggestionOrchestratorDeps } from '../../../src/main/suggestion/index.js';
import type { RetrievalRawHit } from '../../../src/main/retrieval/index.js';

const MIGRATION_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/001_initial_schema.sql',
);

const MIGRATION_002_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/002_queue_timeout_reason.sql',
);

const MIGRATION_003_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/003_empty_normalized_reason.sql',
);

const MIGRATION_004_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/004_semantic_reason_codes.sql',
);

const MIGRATION_005_PATH = join(
  process.cwd(),
  'docs/06-data-interface/migrations/005_llm_semantic_reason_codes.sql',
);

const mockStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf-8'),
};

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

function makeComment(): SourceComment {
  return {
    sourceMessageId: 'msg-1',
    rawEvent: { method: 'WebcastChatMessage', content: '主播晚上好' },
    rawText: '主播晚上好',
    normalizedText: '主播晚上好',
    userNickname: '观众A',
    receivedAt: '2026-08-22T00:00:00.000Z',
    receivedMonotonicMs: 1000,
  };
}

interface SetupOptions {
  hits: RetrievalRawHit[];
  providerResult:
    | { ok: true; output: { action: 'generate'; semantic_type: string; quick_reply: string; cues: string[] } }
    | { ok: true; output: { action: 'reject'; semantic_type: string } }
    | { ok: false; error: { code: string } };
  displayDurationMs?: number;
}

describe('SuggestionAttemptOrchestrator integration (real AuditStoreWorker)', () => {
  let testDir: string;
  let worker: AuditStoreWorker;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'echocue-sugg-integration-'));
    const dbPath = join(testDir, 'audit.sqlite');
    const credStore = new CredentialStore(testDir, mockStorage);
    const keyManager = new CryptoKeyManager(credStore);
    await keyManager.ensureKeys('v1');
    worker = new AuditStoreWorker({
      dbPath,
      migrations: [
        { version: 1, path: MIGRATION_PATH },
        { version: 2, path: MIGRATION_002_PATH },
        { version: 3, path: MIGRATION_003_PATH },
        { version: 4, path: MIGRATION_004_PATH },
        { version: 5, path: MIGRATION_005_PATH },
      ],
      keyManager,
      keyVersion: 'v1',
    });
  });

  afterEach(async () => {
    try {
      worker.close();
    } catch {
      // already closed by a test (audit-unavailable path)
    }
    await rm(testDir, { recursive: true, force: true });
  });

  async function setup(options: SetupOptions): Promise<{
    orchestrator: SuggestionAttemptOrchestrator;
    machine: ServiceStateMachine;
    shown: OverlayDisplayPayloadV1[];
  }> {
    const machine = new ServiceStateMachine();
    machine.transitionToLifecycle('GATE_CONNECTING');
    machine.transitionToLifecycle('RUNNING');
    const shown: OverlayDisplayPayloadV1[] = [];
    const deps: SuggestionOrchestratorDeps = {
      audit: worker,
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
        listPersonas: () => [{ personaId: 'p-1', displayName: '主播A', isPrincipal: true }],
        listAliases: () => [],
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
      retriever: {
        search: async () => ({
          goldenHits: options.hits.filter((h) => h.collection === 'golden_set'),
          preHits: options.hits.filter((h) => h.collection === 'pre_set'),
        }),
      } as never,
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
      createProvider: () =>
        ({
          adapterType: 'OPENAI_COMPATIBLE',
          async generateReply() {
            return options.providerResult;
          },
          getAuditRecord: () => null,
        }) as never,
      validator: new SuggestionOutputValidator(),
      displaySink: {
        async show(payload: OverlayDisplayPayloadV1) {
          shown.push(payload);
          return { ok: true, firstFrameAtMonotonicMs: 100 };
        },
        async hide() {},
      },
      nowMonotonic: () => 2000,
      windowMaxAgeMs: 100000,
      candidateMaxCount: 50,
      directPushThreshold: 0.85,
      displayDurationMs: options.displayDurationMs ?? 100000,
      onAuditFailure: () => {},
    };
    // Session row must exist before any trace references it (FK enforcement).
    worker.createSession({ sessionId: 's1', roomReference: 'room', startedAt: new Date().toISOString() });
    const orchestrator = new SuggestionAttemptOrchestrator(deps);
    await orchestrator.startSession({ sessionId: 's1' });
    return { orchestrator, machine, shown };
  }

  it('writes the full golden direct chain and shows the overlay', async () => {
    const { orchestrator, shown } = await setup({ hits: [goldenHit()], providerResult: { ok: false, error: { code: 'PROTOCOL' } } });
    orchestrator.handleComment(makeComment());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shown.length).toBe(1);
    // NFKC normalization folds the fullwidth ！ into ! (LLM §5.2 step 3).
    expect(shown[0].suggestion).toMatchObject({
      quickReply: '谢谢你!',
      cues: ['接住夸奖', '继续互动'],
      source: 'retrieval_payload',
    });
    orchestrator.finishDisplay();
  });

  it('writes the full LLM chain on a pre_set top1 and shows the overlay', async () => {
    const { orchestrator, shown } = await setup({
      hits: [preHit()],
      providerResult: { ok: true, output: { action: 'generate', semantic_type: 'positive_praise', quick_reply: '谢谢你', cues: ['一', '二'] } },
    });
    orchestrator.handleComment(makeComment());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shown.length).toBe(1);
    expect(shown[0].suggestion).toMatchObject({ quickReply: '谢谢你', cues: ['一', '二'], source: 'llm' });
    orchestrator.finishDisplay();
  });

  it('persists OUTPUT_VALIDATION snapshot rows for the direct path', async () => {
    const { orchestrator } = await setup({ hits: [goldenHit()], providerResult: { ok: false, error: { code: 'PROTOCOL' } } });
    orchestrator.handleComment(makeComment());
    await new Promise((resolve) => setTimeout(resolve, 50));
    orchestrator.finishDisplay();
    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      const rows = reader
        .prepare(
          `SELECT role FROM audit_reference WHERE role = 'OUTPUT_VALIDATION'`,
        )
        .all();
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      reader.close();
    }
  });

  it('auto-hides via the display timer and persists HIDDEN (M5-08)', async () => {
    const { orchestrator } = await setup({
      hits: [goldenHit()],
      providerResult: { ok: false, error: { code: 'PROTOCOL' } },
      displayDurationMs: 30,
    });
    orchestrator.handleComment(makeComment());
    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    try {
      // Poll until the display timer drives finishDisplay; a fixed wait is flaky
      // on slow CI runners where DISPLAYED lands close to the read deadline.
      const deadline = Date.now() + 5000;
      let row: { to_state: string; reason_code: string } | undefined;
      while (row === undefined) {
        row = reader
          .prepare(`SELECT to_state, reason_code FROM audit_transition WHERE to_state = 'HIDDEN'`)
          .get() as { to_state: string; reason_code: string } | undefined;
        if (row !== undefined) break;
        if (Date.now() > deadline) throw new Error('HIDDEN not written within timeout');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(row.reason_code).toBe('DISPLAY_DURATION_ELAPSED');
    } finally {
      reader.close();
    }
  });

  it('replays the four LLM-path snapshots via getTraceWorkflow (M5-09)', async () => {
    const { orchestrator } = await setup({
      hits: [preHit()],
      providerResult: { ok: true, output: { action: 'generate', semantic_type: 'positive_praise', quick_reply: '谢谢你', cues: ['一', '二'] } },
    });
    orchestrator.handleComment(makeComment());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    const traceId = (reader.prepare('SELECT trace_id FROM audit_trace LIMIT 1').get() as { trace_id: string }).trace_id;
    reader.close();
    const workflow = worker.getTraceWorkflow(traceId);
    expect(workflow).not.toBeNull();
    const allSnapshots = workflow!.transitions.flatMap((t) => t.snapshots);
    const roles = allSnapshots.map((s) => s.role);
    expect(roles).toEqual(
      expect.arrayContaining(['RENDERED_PROMPT', 'LLM_REQUEST_META', 'LLM_RAW_RESPONSE', 'LLM_PARSED_OUTPUT']),
    );
    // Decrypted content is replayable and free of the injected key.
    const allPlaintext = allSnapshots.map((s) => s.plaintext.toString()).join('\n');
    expect(allPlaintext).not.toContain('sk-test');
    expect(allPlaintext).not.toContain('Authorization');
  });

  it('persists an LLM semantic reject trace and shows nothing (llm-semantic-reject)', async () => {
    const { orchestrator, shown } = await setup({
      hits: [preHit()],
      providerResult: { ok: true, output: { action: 'reject', semantic_type: 'low_value' } },
    });
    orchestrator.handleComment(makeComment());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(shown.length).toBe(0);
    const reader = new DatabaseSync(join(testDir, 'audit.sqlite'));
    const traceId = (reader.prepare('SELECT trace_id FROM audit_trace LIMIT 1').get() as { trace_id: string }).trace_id;
    const discardRow = reader
      .prepare(`SELECT from_state, to_state, reason_code FROM audit_transition WHERE to_state = 'DISCARDED'`)
      .get() as { from_state: string; to_state: string; reason_code: string } | undefined;
    reader.close();
    expect(discardRow?.from_state).toBe('GENERATED');
    expect(discardRow?.reason_code).toBe('LLM_SEMANTIC_DISCARD');
    const workflow = worker.getTraceWorkflow(traceId);
    expect(workflow).not.toBeNull();
    const allSnapshots = workflow!.transitions.flatMap((t) => t.snapshots);
    const parsedOutput = allSnapshots.find((s) => s.role === 'LLM_PARSED_OUTPUT');
    const finalReason = allSnapshots.find((s) => s.role === 'FINAL_REASON');
    expect(parsedOutput).toBeDefined();
    expect(finalReason).toBeDefined();
    // Reject decisions carry only structured fields (action/semanticType/reason);
    // they must never leak the raw danmaku text or invent reply content.
    for (const snap of [parsedOutput!, finalReason!]) {
      const text = snap.plaintext.toString();
      expect(text).not.toContain(makeComment().rawText);
      expect(text).not.toContain('quick_reply');
      expect(text).not.toContain('cues');
    }
    expect(finalReason!.plaintext.toString()).toContain('LLM_SEMANTIC_DISCARD');
  });

  it('audit-unavailable aborts and does not produce a suggestion', async () => {
    // Close the real worker so writes fail.
    worker.close();
    const machine = new ServiceStateMachine();
    machine.transitionToLifecycle('GATE_CONNECTING');
    machine.transitionToLifecycle('RUNNING');
    let onAuditFailureCalls = 0;
    const orchestrator = new SuggestionAttemptOrchestrator({
      audit: worker,
      stateMachine: machine,
      router: { route: () => ({ personaId: 'p-1', personaVersion: 'v-1', displayName: '主播A', personaMarkdown: 'x', decision: 'principal_fallback', candidates: [] }) } as never,
      personas: { listPersonas: () => [], listAliases: () => [], getVersionMeta: () => ({ contentHmac: 'h' }) } as never,
      safety: { getActivePublishedVersion: async () => 'pol-v1', readPolicy: () => ({ policyText: '', keywords: [], compiledRules: null, validationErrors: null }) } as never,
      retriever: { search: async () => ({ goldenHits: [], preHits: [] }) } as never,
      providerConfig: { getProviderConfig: async () => null } as never,
      credentials: { getCredential: async () => null } as never,
      createProvider: () => ({ adapterType: 'OPENAI_COMPATIBLE', generateReply: async () => ({ ok: false, error: { code: 'PROTOCOL' } }), getAuditRecord: () => null }) as never,
      validator: new SuggestionOutputValidator(),
      displaySink: { show: async () => ({ ok: true, firstFrameAtMonotonicMs: 1 }), hide: async () => {} },
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
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onAuditFailureCalls).toBe(1);
  });
});
