import { describe, expect, it } from 'vitest';
import type { RetrievalInitStatusV1 } from '@echocue/contracts';
import {
  deriveRetrievalBlock,
  describeImportFailure,
} from '../../../src/renderer/main/run/retrieval-state.js';

const SHA = 'a'.repeat(64);

function status(partial: Partial<RetrievalInitStatusV1>): RetrievalInitStatusV1 {
  return { qdrantHealthy: true, ready: false, ...partial };
}

describe('deriveRetrievalBlock', () => {
  it('maps loading while the status IPC is in flight', () => {
    expect(deriveRetrievalBlock(null, true)).toEqual({ kind: 'loading' });
  });

  it('maps unavailable when qdrant is down or the status is missing', () => {
    expect(deriveRetrievalBlock(null, false)).toEqual({ kind: 'unavailable' });
    expect(deriveRetrievalBlock(status({ qdrantHealthy: false }), false)).toEqual({ kind: 'unavailable' });
  });

  it('maps needs-import when healthy but not bootstrapped', () => {
    expect(deriveRetrievalBlock(status({}), false)).toEqual({ kind: 'needs-import' });
  });

  it('maps ready with the profile facts', () => {
    expect(deriveRetrievalBlock(status({ ready: true, profileId: 'p-1', preSetSha256: SHA }), false)).toEqual({
      kind: 'ready',
      profileId: 'p-1',
      preSetSha256: SHA,
    });
  });
});

describe('describeImportFailure', () => {
  it('renders bounded anonymized samples with a total', () => {
    const errors = [
      { line: 2, id: 'pre-000002', path: '/text', errorCode: 'PRE_SET_UNSAFE_CONTENT' as const },
      { line: 0, errorCode: 'PRE_SET_OVER_SIZE' as const },
    ];
    const display = describeImportFailure(errors, true, 5);
    expect(display.total).toBe(2);
    expect(display.truncated).toBe(true);
    expect(display.samples).toHaveLength(2);
    // the formatted line is exactly line/id/path/code — no content property
    expect(display.samples[0]).toBe('/text（pre-000002） PRE_SET_UNSAFE_CONTENT');
    expect(display.samples[1]).toBe('PRE_SET_OVER_SIZE');
    expect(display.samples.join(' ')).not.toMatch(/"text":|"reply":|"description":/);
  });

  it('caps the sample list', () => {
    const errors = Array.from({ length: 10 }, (_, i) => ({ line: i + 1, errorCode: 'PRE_SET_JSON' as const }));
    expect(describeImportFailure(errors, false, 3).samples).toHaveLength(3);
  });
});
