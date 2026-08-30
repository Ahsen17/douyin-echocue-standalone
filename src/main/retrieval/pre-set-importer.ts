import Ajv2020 from 'ajv/dist/2020.js';
import type { PreSetImportErrorCodeV1 } from '@echocue/contracts';
import { detectConfiguredRisk, type CompiledRiskFilter } from '../safety/risk-filter-config.js';
import { normalizeComment } from '../safety/Normalizer.js';
import preSetSchemaV1 from '../../../docs/05-data-interface/schema/pre-set-v1.schema.json';
import type { PreSetEntryV1 } from './types.js';

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024; // 20 MiB
const DEFAULT_MAX_ROWS = 100_000;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validatePreSetSchema = ajv.compile(preSetSchemaV1);

// Single source of truth: the union lives in @echocue/contracts so the same
// codes cross the IPC boundary without a second enum.
export type PreSetImportErrorCode = PreSetImportErrorCodeV1;

export interface PreSetImportError {
  readonly line: number;
  readonly id?: string;
  readonly path?: string;
  readonly errorCode: PreSetImportErrorCode;
}

export type PreSetImportResult =
  | { readonly ok: true; readonly entries: PreSetEntryV1[] }
  | { readonly ok: false; readonly errors: PreSetImportError[] };

export interface PreSetImportOptions {
  maxBytes?: number;
  maxRows?: number;
  /** WP-10: configured risk filter; absent ⇒ no risk filtering on import. */
  riskFilter?: CompiledRiskFilter | null;
}

const SECURITY_FIELDS = ['text', 'description', 'reference_reply'] as const;

function unsafeField(
  entry: PreSetEntryV1,
  riskFilter: CompiledRiskFilter | null,
): string | null {
  if (riskFilter === null) return null;
  for (const field of SECURITY_FIELDS) {
    const value = entry[field];
    if (typeof value === 'string' && detectConfiguredRisk(riskFilter, normalizeComment(value)) !== null) {
      return field;
    }
  }
  return null;
}

export function importPreSet(
  input: { readonly content: string | Buffer },
  options: PreSetImportOptions = {},
): PreSetImportResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  const buffer = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { ok: false, errors: [{ line: 1, errorCode: 'PRE_SET_UTF8_BOM' }] };
  }
  if (buffer.length > maxBytes) {
    return { ok: false, errors: [{ line: 0, errorCode: 'PRE_SET_OVER_SIZE' }] };
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return { ok: false, errors: [{ line: 1, errorCode: 'PRE_SET_ENCODING' }] };
  }

  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop(); // tolerate trailing newline

  if (lines.length === 0) {
    return { ok: false, errors: [{ line: 0, errorCode: 'PRE_SET_EMPTY' }] };
  }
  if (lines.length > maxRows) {
    return { ok: false, errors: [{ line: 0, errorCode: 'PRE_SET_OVER_ROWS' }] };
  }

  const errors: PreSetImportError[] = [];
  const seenIds = new Set<string>();
  const entries: PreSetEntryV1[] = [];

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (line.trim() === '') {
      errors.push({ line: lineNo, errorCode: 'PRE_SET_JSON' });
      return;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      errors.push({ line: lineNo, errorCode: 'PRE_SET_JSON' });
      return;
    }
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      errors.push({ line: lineNo, errorCode: 'PRE_SET_JSON' });
      return;
    }
    const rawId = (obj as { id?: unknown }).id;
    if (!validatePreSetSchema(obj)) {
      const first = validatePreSetSchema.errors?.[0];
      const extra = (first?.params as { additionalProperty?: string } | undefined)?.additionalProperty;
      errors.push({
        line: lineNo,
        id: typeof rawId === 'string' ? rawId : undefined,
        path: first?.instancePath || (extra ? `/${extra}` : undefined),
        errorCode: 'PRE_SET_SCHEMA',
      });
      return;
    }
    const entry = obj as unknown as PreSetEntryV1;
    if (seenIds.has(entry.id)) {
      errors.push({ line: lineNo, id: entry.id, errorCode: 'PRE_SET_DUPLICATE_ID' });
      return;
    }
    const riskField = unsafeField(entry, options.riskFilter ?? null);
    if (riskField !== null) {
      errors.push({ line: lineNo, id: entry.id, path: `/${riskField}`, errorCode: 'PRE_SET_UNSAFE_CONTENT' });
      return;
    }
    seenIds.add(entry.id);
    entries.push(entry);
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, entries };
}
