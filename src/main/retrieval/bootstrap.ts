import { createHash } from 'node:crypto';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type {
  Bm25ZhJiebaProfileV1,
  GoldenSetPayloadV1,
  PreSetPayloadV1,
} from '@echocue/contracts';
import {
  BM25_NORMALIZATION_VERSION_V1,
  BM25_TOKENIZER_VERSION_V1,
  BM25_VECTOR_NAME_V1,
  Bm25ZhJiebaProfileV1Schema,
  PreSetPayloadV1Schema,
} from '@echocue/contracts';
import { createBm25TextPipeline, type Bm25TextPipeline } from './Bm25TextPipeline.js';
import {
  BM25_B_INITIAL,
  BM25_K1_INITIAL,
  buildDocumentVector,
  computeAvgDocLenBaseline,
} from './bm25-weights.js';
import { importPreSet } from './pre-set-importer.js';
import { readGoldenEntries, reencodeGoldenEntries } from './collection-reencode.js';
import type { CompiledRiskFilter } from '../safety/risk-filter-config.js';
import type { Bm25Analysis, PreSetEntryV1 } from './types.js';
import { uuidv5 } from '../util/uuidv5.js';
import { uuidv7 } from '../util/uuidv7.js';
import { tokenId } from './token-id.js';

export const QDRANT_ALIAS_PRE_SET = 'pre_set';
export const QDRANT_ALIAS_GOLDEN_SET = 'golden_set';

/**
 * True when the collection behind the alias was built with a different
 * tokenizer/normalization (or carries no version metadata at all). The single
 * shared check for the retriever guard, the service gate, getStatus and the
 * migration branch, so all of them judge versions the same way.
 */
export async function hasTokenizerVersionMismatch(
  client: QdrantClient,
  alias: string,
): Promise<boolean> {
  const info = await client.getCollection(alias);
  const metadata = (info.config?.metadata ?? {}) as Record<string, unknown>;
  return (
    metadata.tokenizer_version !== BM25_TOKENIZER_VERSION_V1 ||
    metadata.normalization_version !== BM25_NORMALIZATION_VERSION_V1
  );
}

export const PRE_SET_PAYLOAD_INDEX_FIELDS = ['enabled', 'is_bad_case', 'semantic_type'] as const;
export const GOLDEN_SET_PAYLOAD_INDEX_FIELDS = [
  'enabled',
  'is_bad_case',
  'semantic_type',
  'persona_id',
  'persona_version',
] as const;

export function contentSha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

export interface StagedPreSet {
  readonly entry: PreSetEntryV1;
  readonly analyzed: Bm25Analysis;
}

export function stagePreSet(
  entries: readonly PreSetEntryV1[],
  pipeline: Bm25TextPipeline,
): StagedPreSet[] {
  return entries.map((entry) => ({ entry, analyzed: pipeline.analyze(entry.text) }));
}

export interface ComputeProfileInput {
  entries: readonly PreSetEntryV1[];
  pipeline: Bm25TextPipeline;
  preSetSha256: string;
}

export function computeProfile(input: ComputeProfileInput): Bm25ZhJiebaProfileV1 {
  return computeProfileFromStaging(stagePreSet(input.entries, input.pipeline), input.pipeline, input.preSetSha256);
}

export function computeProfileFromStaging(
  staged: readonly StagedPreSet[],
  pipeline: Bm25TextPipeline,
  preSetSha256: string,
): Bm25ZhJiebaProfileV1 {
  const docLengths = staged.map((item) => item.analyzed.docLen);
  const profile = {
    profileId: uuidv7(),
    tokenizerVersion: pipeline.tokenizerVersion,
    normalizationVersion: pipeline.normalizationVersion,
    preSetSha256,
    avgDocLenBaseline: computeAvgDocLenBaseline(docLengths),
    k1: BM25_K1_INITIAL,
    b: BM25_B_INITIAL,
    qdrantVersion: '1.19.0',
    calibrationArtifactId: 'pending-calibration',
  };
  const parsed = Bm25ZhJiebaProfileV1Schema.safeParse(profile);
  if (!parsed.success) {
    throw new Error(`computed profile is invalid: ${JSON.stringify(parsed.error.flatten())}`);
  }
  return profile;
}

export function preSetPointId(caseId: string): string {
  return uuidv5(`echocue:pre_set:${caseId}`);
}

export function toPreSetPayload(entry: PreSetEntryV1, caseId: string): PreSetPayloadV1 {
  const payload = {
    schema_version: '1.0',
    case_id: caseId,
    tokenizer_version: BM25_TOKENIZER_VERSION_V1,
    text: entry.text,
    semantic_type: entry.semantic_type,
    description: entry.description,
    ...(entry.reference_reply !== undefined ? { reference_reply: entry.reference_reply } : {}),
    ...(entry.reference_cues !== undefined ? { reference_cues: entry.reference_cues } : {}),
    ...(entry.tags !== undefined ? { tags: entry.tags } : {}),
    enabled: entry.enabled,
    is_bad_case: entry.is_bad_case,
  } as const;
  return PreSetPayloadV1Schema.parse(payload);
}

export interface CreateCollectionWithSparseOptions {
  collectionName: string;
  profile: Bm25ZhJiebaProfileV1;
  golden: boolean;
}

export async function createCollectionWithSparse(
  client: QdrantClient,
  options: CreateCollectionWithSparseOptions,
): Promise<void> {
  await client.createCollection(options.collectionName, {
    sparse_vectors: {
      [BM25_VECTOR_NAME_V1]: {
        index: { on_disk: false, full_scan_threshold: 10000 },
        modifier: 'idf',
      },
    },
    metadata: {
      profile_id: options.profile.profileId,
      pre_set_sha256: options.profile.preSetSha256,
      qdrant_version: options.profile.qdrantVersion,
      tokenizer_version: options.profile.tokenizerVersion,
      normalization_version: options.profile.normalizationVersion,
      bm25_k1: options.profile.k1,
      bm25_b: options.profile.b,
      avg_doc_len_baseline: options.profile.avgDocLenBaseline,
      calibration_artifact_id: options.profile.calibrationArtifactId,
    },
  });
  const fields = options.golden ? GOLDEN_SET_PAYLOAD_INDEX_FIELDS : PRE_SET_PAYLOAD_INDEX_FIELDS;
  for (const field of fields) {
    await client.createPayloadIndex(options.collectionName, {
      wait: true,
      field_name: field,
      field_schema: field === 'semantic_type' || field === 'persona_id' || field === 'persona_version'
        ? 'keyword'
        : 'bool',
    });
  }
}

export interface BuildPreSetPointsOptions {
  staged: readonly StagedPreSet[];
  profile: Bm25ZhJiebaProfileV1;
}

export function buildPreSetPoints(
  options: BuildPreSetPointsOptions,
): Array<{ id: string; vector: Record<string, { indices: number[]; values: number[] }>; payload: PreSetPayloadV1 }> {
  return options.staged.map(({ entry, analyzed }) => {
    const caseId = entry.id;
    const vector = buildDocumentVector(analyzed, options.profile);
    return {
      id: preSetPointId(caseId),
      vector: { [BM25_VECTOR_NAME_V1]: { indices: vector.indices, values: vector.values } },
      payload: toPreSetPayload(entry, caseId),
    };
  });
}

async function smokeQuery(
  client: QdrantClient,
  collection: string,
  pipeline: Bm25TextPipeline,
  sampleText: string,
): Promise<boolean> {
  const tokens = pipeline.queryTokens(sampleText);
  if (tokens.length === 0) return true;
  const result = await client.query(collection, {
    query: {
      indices: tokens.map((token) => tokenId(token)),
      values: tokens.map(() => 1),
    },
    using: BM25_VECTOR_NAME_V1,
    limit: 1,
  });
  return (result.points?.length ?? 0) > 0;
}

export interface GoldenMigrationInfo {
  reencoded: number;
  skippedEmptyVector: number;
}

export interface BootstrapPreSetOptions {
  content: Buffer | string;
  profile?: Bm25ZhJiebaProfileV1;
  pipeline?: Bm25TextPipeline;
  /** WP-10: configured risk filter (empty ⇒ no risk filtering on import). */
  riskFilter?: CompiledRiskFilter | null;
  /** TD-11: reports what the version migration re-encoded, for the import result. */
  onGoldenMigration?: (info: GoldenMigrationInfo) => void;
}

export async function bootstrapPreSet(
  client: QdrantClient,
  options: BootstrapPreSetOptions,
): Promise<Bm25ZhJiebaProfileV1> {
  const imported = importPreSet({ content: options.content }, { riskFilter: options.riskFilter });
  if (!imported.ok) {
    throw new Error(`pre_set import failed: ${JSON.stringify(imported.errors)}`);
  }
  const pipeline = options.pipeline ?? createBm25TextPipeline();
  const staged = stagePreSet(imported.entries, pipeline);
  const profile = options.profile ?? computeProfileFromStaging(staged, pipeline, contentSha256(options.content));

  // WP-8: only the first bootstrap creates the golden_set collection/alias. A
  // re-import must never replace an existing golden collection, or the host
  // label reflux into golden_set would be wiped (old collection orphaned).
  // The one exception is a tokenizer-version migration: the golden points stay
  // (scroll → re-encode under the new profile) but the collection itself is
  // rebuilt, since mixing tokenizations would make the two collections'
  // scores incomparable.
  const aliases = await client.getAliases();
  const aliasMap = new Map(aliases.aliases.map((a) => [a.alias_name, a.collection_name]));
  const existing = new Set(aliasMap.keys());
  const goldenExists = existing.has(QDRANT_ALIAS_GOLDEN_SET);
  const goldenMigration =
    goldenExists && (await hasTokenizerVersionMismatch(client, aliasMap.get(QDRANT_ALIAS_GOLDEN_SET)!));

  const preSetCollection = `${QDRANT_ALIAS_PRE_SET}__${profile.profileId}`;
  const goldenSetCollection = `${QDRANT_ALIAS_GOLDEN_SET}__${profile.profileId}`;
  await createCollectionWithSparse(client, { collectionName: preSetCollection, profile, golden: false });
  let createdGolden = false;
  if (!goldenExists || goldenMigration) {
    await createCollectionWithSparse(client, { collectionName: goldenSetCollection, profile, golden: true });
    createdGolden = true;
  }

  try {
    const points = buildPreSetPoints({ staged, profile });
    await client.upsert(preSetCollection, { wait: true, points });

    const info = await client.getCollection(preSetCollection);
    const pointCount = info.points_count ?? 0;
    if (pointCount !== points.length) {
      throw new Error(`pre_set point count mismatch: expected ${points.length}, got ${pointCount}`);
    }

    if (staged.length > 0) {
      const searchable = await smokeQuery(client, preSetCollection, pipeline, staged[0].entry.text);
      if (!searchable) {
        throw new Error('pre_set smoke query returned no hits; refusing to publish collection');
      }
    }

    const oldGoldenCollection = aliasMap.get(QDRANT_ALIAS_GOLDEN_SET);
    let migrationInfo: GoldenMigrationInfo | undefined;
    if (goldenMigration) {
      migrationInfo = await reencodeGoldenCollection(client, {
        oldGoldenCollection: oldGoldenCollection!,
        goldenSetCollection,
        profile,
        pipeline,
      });
      options.onGoldenMigration?.(migrationInfo);
    }

    const actions: Array<
      { create_alias: { collection_name: string; alias_name: string } }
      | { delete_alias: { alias_name: string } }
    > = [];
    if (existing.has(QDRANT_ALIAS_PRE_SET)) {
      actions.push({ delete_alias: { alias_name: QDRANT_ALIAS_PRE_SET } });
    }
    actions.push({ create_alias: { collection_name: preSetCollection, alias_name: QDRANT_ALIAS_PRE_SET } });
    if (createdGolden) {
      if (goldenMigration) {
        actions.push({ delete_alias: { alias_name: QDRANT_ALIAS_GOLDEN_SET } });
      }
      actions.push({ create_alias: { collection_name: goldenSetCollection, alias_name: QDRANT_ALIAS_GOLDEN_SET } });
    }
    await client.updateCollectionAliases({ actions });

    // Migration is committed past this point; old collections are cleaned up
    // best-effort so a failed delete never rolls back a finished migration.
    const oldPreSetCollection = aliasMap.get(QDRANT_ALIAS_PRE_SET);
    if (goldenMigration) {
      // Label reflux writes to the golden alias independently of the service,
      // so points may have landed in the old collection between the migration
      // scroll and the alias switch. Replay them into the new collection and
      // only delete the old collections when that replay succeeded — otherwise
      // they stay as a read-only backup instead of losing the stragglers.
      const replayed = await replayLateGoldenWrites(client, {
        oldGoldenCollection: oldGoldenCollection!,
        goldenSetCollection,
        profile,
        pipeline,
      }).catch(() => false);
      if (replayed) {
        for (const name of [oldPreSetCollection, oldGoldenCollection]) {
          if (name !== undefined) await client.deleteCollection(name).catch(() => undefined);
        }
      }
    }

    return profile;
  } catch (err) {
    await client.deleteCollection(preSetCollection).catch(() => undefined);
    if (createdGolden) {
      await client.deleteCollection(goldenSetCollection).catch(() => undefined);
    }
    throw err;
  }
}

async function reencodeGoldenCollection(
  client: QdrantClient,
  deps: {
    oldGoldenCollection: string;
    goldenSetCollection: string;
    profile: Bm25ZhJiebaProfileV1;
    pipeline: Bm25TextPipeline;
  },
): Promise<GoldenMigrationInfo> {
  const entries = await readGoldenEntries(client, deps.oldGoldenCollection);
  const result = reencodeGoldenEntries(entries, deps.profile, deps.pipeline);
  // A migration that silently drops points is data loss; refuse before any
  // alias switch so the old golden collection stays authoritative.
  if (result.skippedInvalidPayload > 0) {
    throw new Error(
      `golden_set re-encode found ${result.skippedInvalidPayload} invalid payload(s); refusing to migrate`,
    );
  }
  await upsertReencodedGolden(client, deps.goldenSetCollection, result);
  const info = await client.getCollection(deps.goldenSetCollection);
  const pointCount = info.points_count ?? 0;
  if (pointCount !== result.points.length) {
    throw new Error(
      `golden_set re-encode point count mismatch: expected ${result.points.length}, got ${pointCount}`,
    );
  }
  return { reencoded: result.points.length, skippedEmptyVector: result.skippedEmptyVector };
}

/**
 * Post-switch replay of golden writes that landed in the old collection during
 * the migration window. Idempotent: re-encoding the same point yields the same
 * id/payload/vector, so overlapping upserts are harmless overwrites.
 */
async function replayLateGoldenWrites(
  client: QdrantClient,
  deps: {
    oldGoldenCollection: string;
    goldenSetCollection: string;
    profile: Bm25ZhJiebaProfileV1;
    pipeline: Bm25TextPipeline;
  },
): Promise<boolean> {
  const entries = await readGoldenEntries(client, deps.oldGoldenCollection);
  const result = reencodeGoldenEntries(entries, deps.profile, deps.pipeline);
  if (result.skippedInvalidPayload > 0) return false;
  await upsertReencodedGolden(client, deps.goldenSetCollection, result);
  return true;
}

async function upsertReencodedGolden(
  client: QdrantClient,
  collection: string,
  result: { points: Array<{ id: string; vector: Record<string, { indices: number[]; values: number[] }>; payload: GoldenSetPayloadV1 }> },
): Promise<void> {
  if (result.points.length === 0) return;
  await client.upsert(collection, {
    wait: true,
    points: result.points.map((p) => ({
      id: p.id,
      vector: p.vector,
      payload: p.payload,
    })),
  });
}
