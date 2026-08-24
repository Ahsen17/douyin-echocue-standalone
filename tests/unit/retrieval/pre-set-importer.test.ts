import { describe, expect, it } from 'vitest';
import { importPreSet } from '../../../src/main/retrieval/index.js';

const VALID_LINE =
  '{"schema_version":"1.0","id":"pre-000001","text":"今天状态真好","semantic_type":"positive_praise","description":"对主播状态的正面夸赞","enabled":true,"is_bad_case":false}';

function validLine(id: string): string {
  return `{"schema_version":"1.0","id":"${id}","text":"状态不错","semantic_type":"positive_praise","description":"d","enabled":true,"is_bad_case":false}`;
}

describe('importPreSet normal path', () => {
  it('imports a valid JSONL package and preserves fields', () => {
    const result = importPreSet({ content: VALID_LINE });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: 'pre-000001',
      text: '今天状态真好',
      semantic_type: 'positive_praise',
      enabled: true,
      is_bad_case: false,
    });
  });

  it('tolerates a single trailing newline', () => {
    const result = importPreSet({ content: `${VALID_LINE}\n` });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries).toHaveLength(1);
  });
});

describe('importPreSet boundary cases', () => {
  it('rejects a package strictly over maxBytes but allows exactly at the limit', () => {
    const maxBytes = Buffer.byteLength(VALID_LINE, 'utf8');
    expect(importPreSet({ content: VALID_LINE }, { maxBytes }).ok).toBe(true);
    const over = Buffer.concat([
      Buffer.from(VALID_LINE, 'utf8'),
      Buffer.from(' ', 'utf8'),
    ]);
    const result = importPreSet({ content: over }, { maxBytes });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ errorCode: 'PRE_SET_OVER_SIZE' });
  });

  it('rejects a package over maxRows but allows exactly at the limit', () => {
    const exactly = `${validLine('pre-000001')}\n${validLine('pre-000002')}\n`;
    expect(importPreSet({ content: exactly }, { maxRows: 2 }).ok).toBe(true);
    const over = `${exactly}${validLine('pre-000003')}\n`;
    const result = importPreSet({ content: over }, { maxRows: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ errorCode: 'PRE_SET_OVER_ROWS' });
  });

  it('rejects an empty package', () => {
    const result = importPreSet({ content: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ errorCode: 'PRE_SET_EMPTY' });
  });

  it('rejects an interior blank line', () => {
    const content = `${VALID_LINE}\n\n${VALID_LINE}\n`;
    const result = importPreSet({ content });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContainEqual({ line: 2, errorCode: 'PRE_SET_JSON' });
  });
});

describe('importPreSet failure paths', () => {
  it('rejects a UTF-8 BOM, including a BOM-only package', () => {
    const content = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(VALID_LINE, 'utf8'),
    ]);
    const result = importPreSet({ content });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ errorCode: 'PRE_SET_UTF8_BOM' });
    const bomOnly = importPreSet({ content: Buffer.from([0xef, 0xbb, 0xbf]) });
    expect(bomOnly.ok).toBe(false);
    if (!bomOnly.ok) expect(bomOnly.errors[0]).toMatchObject({ errorCode: 'PRE_SET_UTF8_BOM' });
  });

  it('rejects invalid UTF-8 bytes', () => {
    const result = importPreSet({ content: Buffer.from([0xff, 0xfe, 0x41]) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ errorCode: 'PRE_SET_ENCODING' });
  });

  it('rejects malformed JSON lines and non-object lines', () => {
    const result = importPreSet({ content: '{not json}\n[1,2,3]\n' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual({ line: 1, errorCode: 'PRE_SET_JSON' });
      expect(result.errors).toContainEqual({ line: 2, errorCode: 'PRE_SET_JSON' });
    }
  });

  it('rejects schema violations with a JSON pointer path', () => {
    const bad = '{"schema_version":"1.0","id":"pre-000002","text":"","semantic_type":"positive_praise","description":"d","enabled":true,"is_bad_case":false}';
    const result = importPreSet({ content: bad });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].errorCode).toBe('PRE_SET_SCHEMA');
      expect(result.errors[0].path).toBe('/text');
    }
  });

  it('surfaces the offending key for additionalProperties violations', () => {
    const bad = '{"schema_version":"1.0","id":"pre-000002","text":"状态不错","semantic_type":"positive_praise","description":"d","unexpected":true,"enabled":true,"is_bad_case":false}';
    const result = importPreSet({ content: bad });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].errorCode).toBe('PRE_SET_SCHEMA');
      expect(result.errors[0].path).toBe('/unexpected');
    }
  });

  it('rejects duplicate ids, flagging the second occurrence', () => {
    const content = `${VALID_LINE}\n${VALID_LINE.replace('"id":"pre-000001"', '"id":"pre-000001"')}\n`;
    const result = importPreSet({ content });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual({ line: 2, id: 'pre-000001', errorCode: 'PRE_SET_DUPLICATE_ID' });
    }
  });

  it('rejects entries containing configured risk keywords', () => {
    const bad = '{"schema_version":"1.0","id":"pre-000003","text":"这里是我的手机号请勿外传","semantic_type":"positive_praise","description":"d","enabled":true,"is_bad_case":false}';
    const result = importPreSet(
      { content: bad },
      { riskFilter: [{ typeId: 'privacy', label: '隐私', terms: ['手机号'] }] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({ errorCode: 'PRE_SET_UNSAFE_CONTENT', path: '/text' });
    }
  });

  it('checks the reference_reply security field too', () => {
    const bad = '{"schema_version":"1.0","id":"pre-000003","text":"状态不错","semantic_type":"positive_praise","description":"d","reference_reply":"请加我手机号咨询","enabled":true,"is_bad_case":false}';
    const result = importPreSet(
      { content: bad },
      { riskFilter: [{ typeId: 'privacy', label: '隐私', terms: ['手机号'] }] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({ errorCode: 'PRE_SET_UNSAFE_CONTENT', path: '/reference_reply' });
    }
  });

  it('allows content that would be risky when no risk filter is configured (WP-10)', () => {
    const content = '{"schema_version":"1.0","id":"pre-000003","text":"这里是我的手机号请勿外传","semantic_type":"positive_praise","description":"d","enabled":true,"is_bad_case":false}';
    const result = importPreSet({ content });
    expect(result.ok).toBe(true);
  });
});

describe('importPreSet privacy', () => {
  it('never includes raw content in the error report', () => {
    const sensitive = '这里是我的手机号请勿外传';
    const bad = `{"schema_version":"1.0","id":"pre-000004","text":"${sensitive}","semantic_type":"positive_praise","description":"${sensitive}","enabled":true,"is_bad_case":false}`;
    const result = importPreSet(
      { content: bad },
      { riskFilter: [{ typeId: 'privacy', label: '隐私', terms: ['手机号'] }] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const serialized = JSON.stringify(result.errors);
      expect(serialized).not.toContain(sensitive);
      expect(serialized).toContain('PRE_SET_UNSAFE_CONTENT');
    }
  });
});
