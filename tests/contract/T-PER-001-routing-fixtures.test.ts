import { describe, it, expect } from 'vitest';
import { loadJsonFixture, FIXTURES } from '../fixtures/index.js';
import {
  routePersona,
  FUZZY_MATCH_THRESHOLD,
  type AliasKind,
  type PersonaRoutingData,
} from '../../src/main/persona/index.js';
import { normalizeComment } from '../../src/main/safety/index.js';

interface AliasFixture {
  text: string;
  kind: string;
}

interface MemberFixture {
  personaId: string;
  displayName: string;
  isPrincipal: boolean;
  aliases: AliasFixture[];
}

interface RoutingCaseFixture {
  id: string;
  text: string;
  expected: { personaId: string; decision: string };
}

interface RoutingFixture {
  schemaVersion: number;
  fuzzyMatchThreshold: number;
  members: MemberFixture[];
  routingCases: RoutingCaseFixture[];
}

describe('T-PER-001: Persona Routing Fixtures', () => {
  const fixture = loadJsonFixture<RoutingFixture>(FIXTURES.PERSONA_ROUTING);

  it('should declare the schema version and fuzzy threshold', () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.fuzzyMatchThreshold).toBe(FUZZY_MATCH_THRESHOLD);
  });

  it('should run every routing case to the fixture persona and decision', () => {
    expect(fixture.routingCases.length).toBeGreaterThan(0);

    const routingData: PersonaRoutingData[] = fixture.members.map((m) => ({
      personaId: m.personaId,
      displayName: m.displayName,
      isPrincipal: m.isPrincipal,
      aliases: m.aliases.map((a) => ({
        aliasText: a.text,
        aliasKind: a.kind as AliasKind,
        enabled: true,
      })),
    }));

    for (const c of fixture.routingCases) {
      const result = routePersona(normalizeComment(c.text), routingData);
      expect(result.personaId).toBe(c.expected.personaId);
      expect(result.decision).toBe(c.expected.decision);
    }
  });
});
