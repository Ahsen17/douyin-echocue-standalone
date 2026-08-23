import { describe, expect, it } from 'vitest';
import {
  PreSetImportErrorV1Schema,
  PreSetImportResultV1Schema,
  PreSetImportRequestV1Schema,
  RetrievalInitStatusV1Schema,
} from '@echocue/contracts';
import { loadJsonFixture } from '../fixtures/loader.js';
import { FIXTURES } from '../fixtures/loader.js';

interface ImportFixture {
  version: string;
  status: {
    ready: unknown;
    needsImport: unknown;
    unavailable: unknown;
  };
  importResult: {
    ok: unknown;
    failed: unknown;
  };
}

const fixture = loadJsonFixture<ImportFixture>(FIXTURES.RETRIEVAL_INIT_IMPORT);

describe('T-RET-001 retrieval init status payloads', () => {
  it('accepts the ready / needs-import / unavailable fixtures', () => {
    expect(RetrievalInitStatusV1Schema.safeParse(fixture.status.ready).success).toBe(true);
    expect(RetrievalInitStatusV1Schema.safeParse(fixture.status.needsImport).success).toBe(true);
    expect(RetrievalInitStatusV1Schema.safeParse(fixture.status.unavailable).success).toBe(true);
  });

  it('ready status carries an anonymous profileId and preSetSha256 only', () => {
    const parsed = RetrievalInitStatusV1Schema.parse(fixture.status.ready);
    expect(parsed.ready).toBe(true);
    expect(parsed.qdrantHealthy).toBe(true);
    expect(parsed.profileId).toMatch(/^[0-9a-f]+$/);
    expect(parsed.preSetSha256).toMatch(/^[0-9a-f]{64}$/);
    // no retrieval payloads or case text cross the status IPC
    expect(JSON.stringify(parsed)).not.toContain('text');
  });
});

describe('T-RET-001 pre_set import result payloads', () => {
  it('accepts the ok result with a frozen Bm25 profile and entry count', () => {
    const parsed = PreSetImportResultV1Schema.parse(fixture.importResult.ok);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.entryCount).toBeGreaterThan(0);
      expect(parsed.profile.avgDocLenBaseline).toBeGreaterThan(0);
      expect(parsed.profile.preSetSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('accepts the failed result and keeps errors line-scoped and content-free', () => {
    const parsed = PreSetImportResultV1Schema.parse(fixture.importResult.failed);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.truncated).toBe(true);
    for (const err of parsed.errors) {
      expect(PreSetImportErrorV1Schema.safeParse(err).success).toBe(true);
      // errors carry only line/id/path/errorCode — never the case content
      for (const key of Object.keys(err)) {
        expect(['line', 'id', 'path', 'errorCode']).toContain(key);
      }
      expect(JSON.stringify(err)).not.toMatch(/"text":|"reply":|"description":|"reference_reply":|"reference_cues":/);
    }
  });

  it('rejects a result whose ok branch disagrees with its fields', () => {
    const bad = { ...(fixture.importResult.failed as object), ok: true };
    expect(PreSetImportResultV1Schema.safeParse(bad).success).toBe(false);
  });
});

describe('T-RET-001 pre_set import request payload', () => {
  it('accepts a content string request', () => {
    expect(PreSetImportRequestV1Schema.safeParse({ content: '{"id":"pre-000001"}' }).success).toBe(true);
  });

  it('rejects a non-string content', () => {
    expect(PreSetImportRequestV1Schema.safeParse({ content: 42 }).success).toBe(false);
  });
});
