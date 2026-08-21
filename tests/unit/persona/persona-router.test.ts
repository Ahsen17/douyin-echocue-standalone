import { describe, it, expect } from 'vitest';
import {
  routePersona,
  FUZZY_MATCH_THRESHOLD,
  PersonaRouterUnavailableError,
  type AliasKind,
  type PersonaRoutingData,
} from '../../../src/main/persona/index.js';

function member(
  personaId: string,
  displayName: string,
  isPrincipal: boolean,
  aliases: Array<[string, AliasKind, boolean?]> = [],
): PersonaRoutingData {
  return {
    personaId,
    displayName,
    isPrincipal,
    aliases: aliases.map(([aliasText, aliasKind, enabled = true]) => ({ aliasText, aliasKind, enabled })),
  };
}

const TEAM = [
  member('principal', '阿远', true, [['阿远', 'NAME']]),
  member('xiaohong', '小红', false, [
    ['小红', 'NICKNAME'],
    ['小虹', 'TYPO_VARIANT'],
  ]),
  member('xiaobai', '小白', false, [
    ['小白', 'NICKNAME'],
    ['白哥', 'ALIAS'],
  ]),
  member('xin', '小新', false, [['恭喜发财红包', 'NICKNAME']]),
];

describe('routePersona', () => {
  it('routes an exact nickname to that member', () => {
    const r = routePersona('小红今天状态真好', TEAM);
    expect(r.decision).toBe('exact');
    expect(r.personaId).toBe('xiaohong');
    expect(r.candidates).toContainEqual({ personaId: 'xiaohong', matchedAlias: '小红', score: 1 });
  });

  it('routes an exact display name to that member', () => {
    const r = routePersona('小白加油', TEAM);
    expect(r.decision).toBe('exact');
    expect(r.personaId).toBe('xiaobai');
  });

  it('routes a configured TYPO_VARIANT alias via exact match', () => {
    const r = routePersona('小虹你好呀', TEAM);
    expect(r.decision).toBe('exact');
    expect(r.personaId).toBe('xiaohong');
    expect(r.candidates).toContainEqual({ personaId: 'xiaohong', matchedAlias: '小虹', score: 1 });
  });

  it('falls back to the principal when no member is named', () => {
    const r = routePersona('今天状态真好，给大家分享一下吧', TEAM);
    expect(r.decision).toBe('principal_fallback');
    expect(r.personaId).toBe('principal');
    expect(r.candidates).toHaveLength(0);
  });

  it('falls back to the principal on ambiguous multi-member mention', () => {
    const r = routePersona('小红和小白一起上吧', TEAM);
    expect(r.decision).toBe('principal_fallback');
    expect(r.personaId).toBe('principal');
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates.map((c) => c.personaId).sort()).toEqual(['xiaobai', 'xiaohong']);
  });

  it('falls back to the principal on a low-confidence unconfigured typo', () => {
    const r = routePersona('小宏你好呀', TEAM);
    expect(r.decision).toBe('principal_fallback');
    expect(r.personaId).toBe('principal');
  });

  it('accepts a single high-confidence unique fuzzy match', () => {
    const r = routePersona('恭喜发财红宝新年好', TEAM);
    expect(r.decision).toBe('fuzzy_unique');
    expect(r.personaId).toBe('xin');
    expect(r.candidates[0].score).toBeGreaterThanOrEqual(FUZZY_MATCH_THRESHOLD);
    expect(r.candidates[0].matchedAlias).toBe('恭喜发财红包');
  });

  it('ignores disabled aliases', () => {
    const team = [
      member('principal', '阿远', true, [['阿远', 'NAME']]),
      member('xiaobai', '小白', false, [['白哥', 'ALIAS', false]]),
    ];
    const r = routePersona('白哥你好', team);
    expect(r.decision).toBe('principal_fallback');
    expect(r.personaId).toBe('principal');
  });

  it('falls back to the principal on empty or whitespace text', () => {
    expect(routePersona('', TEAM).decision).toBe('principal_fallback');
    expect(routePersona('   ', TEAM).decision).toBe('principal_fallback');
  });

  it('throws when no principal persona exists', () => {
    const noPrincipal = [
      member('xiaohong', '小红', false, [['小红', 'NICKNAME']]),
    ];
    expect(() => routePersona('小红你好', noPrincipal)).toThrowError(PersonaRouterUnavailableError);
    expect(() => routePersona('小红你好', noPrincipal)).toThrowError(/principal/i);
  });

  it('throws on an empty team', () => {
    expect(() => routePersona('你好', [])).toThrowError(PersonaRouterUnavailableError);
  });

  it('falls back to the principal when two members fuzzy-match at the threshold', () => {
    const team = [
      member('principal', '阿远', true, [['阿远', 'NAME']]),
      member('a', '阿甲', false, [['恭喜发财红包', 'NICKNAME']]),
      member('b', '阿乙', false, [['恭喜发财红金', 'NICKNAME']]),
    ];
    const r = routePersona('恭喜发财红宝新年好', team);
    expect(r.decision).toBe('principal_fallback');
    expect(r.personaId).toBe('principal');
    expect(r.candidates).toHaveLength(2);
  });

  it('deduplicates when displayName equals an alias', () => {
    const team = [
      member('principal', '阿远', true, [['阿远', 'NAME']]),
      member('xiaohong', '小红', false, [
        ['小红', 'NICKNAME'],
        ['小虹', 'TYPO_VARIANT'],
      ]),
    ];
    const r = routePersona('小红今天状态真好', team);
    expect(r.decision).toBe('exact');
    expect(r.personaId).toBe('xiaohong');
    // 小红 appears once as displayName and alias; the candidate must not duplicate.
    expect(r.candidates.filter((c) => c.personaId === 'xiaohong')).toHaveLength(1);
    expect(r.candidates).toContainEqual({ personaId: 'xiaohong', matchedAlias: '小红', score: 1 });
  });

  it('keeps the longest alias hit per persona', () => {
    const team = [
      member('principal', '阿远', true, [['阿远', 'NAME']]),
      member('xiaohong', '小红', false, [
        ['小虹', 'TYPO_VARIANT'],
        ['小虹姐', 'NICKNAME'],
      ]),
    ];
    const r = routePersona('小虹姐你好呀', team);
    expect(r.decision).toBe('exact');
    expect(r.personaId).toBe('xiaohong');
    expect(r.candidates).toContainEqual({ personaId: 'xiaohong', matchedAlias: '小虹姐', score: 1 });
  });
});
