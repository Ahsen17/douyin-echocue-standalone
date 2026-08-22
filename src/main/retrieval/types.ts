import type { SemanticTypeV1 } from '@echocue/contracts';

export interface Bm25Analysis {
  readonly tokens: readonly string[];
  readonly tf: ReadonlyMap<string, number>;
  readonly docLen: number;
}

// Mirrors docs/05-data-interface/schema/pre-set-v1.schema.json; runtime
// validation authority is that JSON Schema (via ajv), not this interface.
export interface PreSetEntryV1 {
  schema_version: '1.0';
  id: string;
  text: string;
  semantic_type: SemanticTypeV1;
  description: string;
  reference_reply?: string;
  reference_cues?: string[];
  tags?: string[];
  enabled: boolean;
  is_bad_case: boolean;
}
