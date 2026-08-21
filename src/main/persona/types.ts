// Alias kinds mirror the persona_alias.alias_kind CHECK constraint in
// 001_initial_schema.sql; the shared contract does not define this enum, the
// DB CHECK constraint is the backstop.
export const ALIAS_KINDS_V1 = ['NAME', 'NICKNAME', 'ALIAS', 'TYPO_VARIANT'] as const;
export type AliasKind = (typeof ALIAS_KINDS_V1)[number];

export interface AliasInput {
  aliasText: string;
  aliasKind: AliasKind;
  enabled?: boolean;
}

export interface CreatePersonaParams {
  personaId: string;
  displayName: string;
  isPrincipal: boolean;
  aliases?: AliasInput[];
}

export interface UpdatePersonaParams {
  displayName?: string;
  isPrincipal?: boolean;
}

export interface UpdateAliasParams {
  aliasText?: string;
  aliasKind?: AliasKind;
  enabled?: boolean;
}

export interface PersonaSummary {
  personaId: string;
  displayName: string;
  isPrincipal: boolean;
  activeVersion: string | null;
  createdAt: string;
  updatedAt: string;
  aliasCount: number;
  versionCount: number;
}

export interface AliasRow {
  aliasId: string;
  personaId: string;
  aliasText: string;
  aliasKind: AliasKind;
  enabled: boolean;
}
