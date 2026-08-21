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

export const PERSONA_VERSION_STATUSES = ['DRAFT', 'PUBLISHED', 'SUPERSEDED'] as const;
export type PersonaVersionStatus = (typeof PERSONA_VERSION_STATUSES)[number];

export interface CreateDraftParams {
  personaId: string;
  content: string;
  fromVersion?: string;
}

export interface PersonaVersionMeta {
  personaVersion: string;
  personaId: string;
  status: PersonaVersionStatus;
  contentHmac: string;
  createdAt: string;
  publishedAt: string | null;
  createdFromVersion: string | null;
}

export interface VersionComparison {
  a: PersonaVersionMeta;
  b: PersonaVersionMeta;
  sameContent: boolean;
}
