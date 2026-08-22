import { describe, expect, it } from 'vitest';
import {
  AuditContentTypeV1Schema,
  AuditSnapshotRoleV1Schema,
} from '@echocue/contracts';
import { FIXTURES, loadJsonFixture } from '../fixtures/loader.js';

interface SnapshotRoleFixture {
  role: string;
  contentType: string;
  minimal: Record<string, unknown>;
  forbiddenProbes: string[];
}

interface AuditSnapshotFixture {
  schemaVersion: number;
  roles: SnapshotRoleFixture[];
}

describe('T-AUD-001: audit snapshot fixtures (M5-09)', () => {
  const fixture = loadJsonFixture<AuditSnapshotFixture>(FIXTURES.AUDIT_SNAPSHOT);
  const validContentTypes = new Set<string>(AuditContentTypeV1Schema.options);
  const validRoles = new Set<string>(AuditSnapshotRoleV1Schema.options);

  it('covers all four LLM-path roles with valid enum values', () => {
    expect(fixture.schemaVersion).toBe(1);
    const roles = fixture.roles.map((r) => r.role);
    expect(roles).toEqual(
      expect.arrayContaining(['RENDERED_PROMPT', 'LLM_REQUEST_META', 'LLM_RAW_RESPONSE', 'LLM_PARSED_OUTPUT']),
    );
    for (const r of fixture.roles) {
      expect(validRoles.has(r.role)).toBe(true);
      expect(validContentTypes.has(r.contentType)).toBe(true);
    }
  });

  it('each minimal payload carries required fields and no forbidden probes (LLM §7)', () => {
    for (const r of fixture.roles) {
      expect(r.minimal).toBeTruthy();
      const payloadText = JSON.stringify(r.minimal).toLowerCase();
      for (const probe of r.forbiddenProbes) {
        expect(payloadText).not.toContain(probe.toLowerCase());
      }
    }
  });
});
