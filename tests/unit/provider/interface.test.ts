import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { TextGenerationProvider } from '../../../src/main/provider/index.js';
import type {
  ProviderGenerateError,
  ProviderGenerateInput,
  ProviderGenerateOk,
} from '../../../src/main/provider/index.js';

const ROOT = resolve(__dirname, '../../..');

describe('TextGenerationProvider stable interface', () => {
  it('generateReply input requires a hard timeout', () => {
    const input: ProviderGenerateInput = {
      sessionId: 's',
      traceId: 't',
      windowVersion: 1,
      providerId: 'p',
      adapterType: 'DEEPSEEK',
      baseUrl: 'https://api.deepseek.com',
      modelId: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      apiKey: 'sk-x',
      timeoutMs: 5000,
      freshnessDeadlineMonotonicMs: 1,
      abortSignal: new AbortController().signal,
    };
    expect(input.timeoutMs).toBe(5000);
  });

  it('ok and error branches are structurally distinguishable', () => {
    const ok: ProviderGenerateOk = {
      ok: true,
      output: { quick_reply: 'x', cues: ['a', 'b'] },
      providerRequestId: 'req-1',
    };
    const err: ProviderGenerateError = {
      ok: false,
      error: { code: 'AUTH', providerStatus: 401 },
    };
    expect(ok.ok).toBe(true);
    expect(err.ok).toBe(false);
    // Discriminated-union invariants at runtime: no cross-field leakage.
    expect('output' in err).toBe(false);
    expect('error' in ok).toBe(false);
    expect('providerStatus' in ok).toBe(false);
    expect((err.error as { providerStatus?: number }).providerStatus).toBe(401);
  });

  it('provider module imports shared types from @echocue/contracts and never redefines enums', () => {
    // http.ts is transport-only and legitimately has no contract imports; skip it for the positive check.
    const filesRequiringContracts = [
      'src/main/provider/types.ts',
      'src/main/provider/errors.ts',
      'src/main/provider/TextGenerationProvider.ts',
      'src/main/provider/provider-config.ts',
      'src/main/provider/provider-control-handlers.ts',
    ];
    const allSourceFiles = [...filesRequiringContracts, 'src/main/provider/http.ts'];
    for (const file of allSourceFiles) {
      const content = readFileSync(resolve(ROOT, file), 'utf-8');
      // Shared contract types must never be re-declared locally.
      expect(content).not.toMatch(/export\s+(const|enum)\s+ProviderErrorV1\b/i);
      expect(content).not.toMatch(/export\s+(const|enum)\s+SuggestionOutputV1\b/i);
      expect(content).not.toMatch(/export\s+(const|enum)\s+DomainErrorV1\b/i);
      expect(content).not.toMatch(/export\s+(const|enum)\s+ProviderConfigV1\b/i);
    }
    for (const file of filesRequiringContracts) {
      const content = readFileSync(resolve(ROOT, file), 'utf-8');
      expect(content, `${file} must import shared types from @echocue/contracts`).toMatch(
        /@echocue\/contracts/,
      );
    }
  });

  it('TextGenerationProvider interface is satisfied by a conforming adapter', () => {
    const adapter: TextGenerationProvider = {
      adapterType: 'DEEPSEEK',
      generateReply: async () => ({ ok: true, output: { quick_reply: 'x', cues: ['a', 'b'] } }),
      getAuditRecord: () => null,
    };
    expect(adapter.adapterType).toBe('DEEPSEEK');
    expect(typeof adapter.generateReply).toBe('function');
    expect(typeof adapter.getAuditRecord).toBe('function');
  });
});
