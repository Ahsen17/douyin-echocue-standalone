import { describe, it, expect } from 'vitest';
import * as contracts from '@echocue/contracts';
import { IpcChannel } from '../../src/shared/ipc-channels.js';
import { DouyinLiveWsAdapter } from '../../src/main/douyin/index.js';

// T-SCOPE-001 范围反向测试 (DELIVERY §4.4): asserts the product NEVER exposes
// capabilities outside the MVP boundary — auto-send danmaku, multi-room/MCN
// backend, cloud audit, or user-visible retrieval internals. The assertions
// target public API surfaces (IPC allowlist, contract schemas, adapter public
// methods), never source text, so they stay meaningful as the contract evolves.
const FORBIDDEN_CHANNEL = [
  /send/i,
  /danmaku/i,
  /audit.*(export|clear|purge|sync)|(export|clear|purge|sync).*audit/i,
  /multi.?room|mcn/i,
  /golden|bad.?case|sync.?status|threshold/i,
];

// Sanctioned user-facing retrieval surfaces (RUNBOOK §3.1: import pre_set +
// readiness status + diagnostic collection point counts). Any other retrieval.*
// channel would be an internal leak — golden/bad-case/sync/threshold stay
// forbidden by FORBIDDEN_CHANNEL.
const SANCTIONED_RETRIEVAL_CHANNELS = new Set([
  'retrieval.getStatus',
  'retrieval.importPreSet',
  'retrieval.getCollectionCounts',
]);

const FORBIDDEN_USER_VISIBLE_KEY = [
  /golden|bad.?case|sync|threshold|score|confidence|envelope/i,
];

// Sanctioned T-SCOPE-001 exception: the Run page exposes exactly these two
// user-tunable retrieval thresholds (direct golden push + low-value semantic
// discard), per product decision. The internal calibration artifact, windowing,
// candidate caps and golden/sync internals stay forbidden.
const SANCTIONED_CONFIG_VIEW_KEYS = new Set([
  'directPushThreshold',
  'semanticDiscardConfidence',
]);

const FORBIDDEN_SOURCE_EVENT_TYPE = /send|publish|write|push|reply/i;

function schemaKeys(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape);
}

describe('T-SCOPE-001: Scope Reverse (范围反向)', () => {
  it('the IPC channel allowlist carries no out-of-scope capability', () => {
    const channels = Object.values(IpcChannel) as string[];
    expect(channels.length).toBeGreaterThan(20);
    for (const pattern of FORBIDDEN_CHANNEL) {
      for (const channel of channels) {
        expect(channel).not.toMatch(pattern);
      }
    }
    // A retrieval.* channel is only allowed as the sanctioned init surface; the
    // internal retrieval knobs (golden/bad-case/sync/threshold) must never leak.
    for (const channel of channels) {
      if (channel.startsWith('retrieval.')) {
        expect(SANCTIONED_RETRIEVAL_CHANNELS.has(channel)).toBe(true);
      }
    }
  });

  it('the douyin source adapter is consume-only with no room-write method', () => {
    const proto = Object.getOwnPropertyNames(DouyinLiveWsAdapter.prototype);
    // The consume-only surface that drives the stream must exist.
    for (const name of ['connect', 'close', 'onEvent']) {
      expect(proto).toContain(name);
    }
    // No public method writes back to the room socket.
    for (const name of proto) {
      expect(name).not.toMatch(/^(send|write|post|publish|push|reply)/i);
    }
  });

  it('the live source event contract has no outbound event type', () => {
    const variants = contracts.LiveSourceEventSchema.options.map(
      (option) => (option.shape.type as { value: string }).value,
    );
    expect(variants.sort()).toEqual(
      ['COMMENT', 'LIVE_ENDED', 'LIVE_OFFLINE', 'LIVE_ONLINE', 'SOURCE_ERROR'].sort(),
    );
    for (const variant of variants) {
      expect(variant).not.toMatch(FORBIDDEN_SOURCE_EVENT_TYPE);
    }
  });

  it('the user-visible config view excludes retrieval internals that Settings keeps internal', () => {
    // Main-process persisted settings legitimately hold the internal retrieval
    // profile (thresholds, windowing) — but they must never cross IPC to the
    // renderer (CONTRACT §7 / UI §7.1).
    expect(schemaKeys(contracts.SettingsV1Schema)).toContain('internalRetrieval');
    expect(schemaKeys(contracts.ConfigViewV1Schema)).not.toContain('internalRetrieval');
    for (const pattern of FORBIDDEN_USER_VISIBLE_KEY) {
      for (const key of schemaKeys(contracts.ConfigViewV1Schema)) {
        if (SANCTIONED_CONFIG_VIEW_KEYS.has(key)) continue;
        expect(key).not.toMatch(pattern);
      }
    }
  });

  it('config is single-room with no rooms/MCN/cloud-audit surface', () => {
    for (const key of schemaKeys(contracts.SettingsV1Schema)) {
      expect(key).not.toMatch(/^(rooms|streams|channels|mcn|cloud)$/i);
    }
    expect(schemaKeys(contracts.SettingsV1Schema)).toContain('roomReference');
    expect(schemaKeys(contracts.ConfigViewV1Schema)).toContain('roomReference');
    // Cloud-audit would need a remote target; neither settings nor config has one.
    for (const key of [...schemaKeys(contracts.SettingsV1Schema), ...schemaKeys(contracts.ConfigViewV1Schema)]) {
      expect(key).not.toMatch(/endpoint|remote|cloud|push.?url/i);
    }
  });

  it('the audit IPC schemas expose no internal golden/sync/threshold fields', () => {
    for (const schema of [contracts.AuditSearchRequestV1Schema, contracts.AuditWorkflowV1Schema]) {
      for (const pattern of FORBIDDEN_USER_VISIBLE_KEY) {
        for (const key of schemaKeys(schema)) {
          expect(key).not.toMatch(pattern);
        }
      }
    }
  });
});
