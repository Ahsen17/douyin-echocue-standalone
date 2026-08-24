import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importPreSet } from '../../src/main/retrieval/index.js';
import { compileRiskFilter } from '../../src/main/safety/index.js';
import { FIXTURES } from '../fixtures/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_ROOT = resolve(__dirname, '../../docs/06-data-interface/fixtures');
const CANONICAL_ROOT = resolve(__dirname, '../../docs/05-data-interface/fixtures');

function readRaw(root: string, name: string): Buffer {
  return readFileSync(resolve(root, name));
}

function nonEmptyLines(content: Buffer): number {
  return content.toString('utf8').split('\n').filter((l) => l.trim() !== '').length;
}

describe('T-RET-001 pre_set valid package import', () => {
  it('imports the contract fixture whole-package', () => {
    const raw = readRaw(CONTRACT_ROOT, FIXTURES.PRE_SET_VALID);
    const result = importPreSet({ content: raw });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toHaveLength(nonEmptyLines(raw));
    expect(new Set(result.entries.map((e) => e.id)).size).toBe(result.entries.length);
  });

  it('imports the canonical docs/05 valid fixture', () => {
    const result = importPreSet({ content: readRaw(CANONICAL_ROOT, 'pre-set-valid.jsonl') });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries).toHaveLength(1);
  });
});

describe('T-RET-001 pre_set invalid package whole-reject', () => {
  // WP-10: the unsafe-content fixture entry is rejected by the configured risk
  // filter (the importer no longer ships always-on builtin detectors).
  const riskFilter = compileRiskFilter([{ typeId: 'PII', label: '隐私', keywords: ['手机号'] }]);

  it('rejects the contract fixture with every failure category reported', () => {
    const result = importPreSet({ content: readRaw(CONTRACT_ROOT, FIXTURES.PRE_SET_INVALID) }, { riskFilter });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.errors.map((e) => e.errorCode);
    expect(codes.filter((c) => c === 'PRE_SET_JSON').length).toBeGreaterThanOrEqual(2);
    expect(codes.filter((c) => c === 'PRE_SET_SCHEMA').length).toBeGreaterThanOrEqual(5);
    expect(codes).toContain('PRE_SET_DUPLICATE_ID');
    expect(codes).toContain('PRE_SET_UNSAFE_CONTENT');
    // no partial entries leak out of a failed import
    expect(result).not.toHaveProperty('entries');
  });

  it('rejects the canonical docs/05 invalid fixture', () => {
    const result = importPreSet({ content: readRaw(CANONICAL_ROOT, 'pre-set-invalid.jsonl') }, { riskFilter });
    expect(result.ok).toBe(false);
  });

  it('keeps the error report free of raw content', () => {
    const result = importPreSet({ content: readRaw(CONTRACT_ROOT, FIXTURES.PRE_SET_INVALID) }, { riskFilter });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialized = JSON.stringify(result.errors);
    expect(serialized).not.toMatch(/手机号|版本不支持的案例|bad json line/);
  });
});
