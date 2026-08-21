export {
  PersonaStore,
  PersonaStoreUnavailableError,
  PersonaNotFoundError,
  PersonaPrincipalConflictError,
  PersonaPrincipalDeletionError,
  PersonaReferencedError,
  AliasNotFoundError,
  AliasDuplicateError,
  PersonaInvalidParamsError,
} from './PersonaStore.js';
export type { PersonaStoreOptions } from './PersonaStore.js';
export {
  ALIAS_KINDS_V1,
  type AliasInput,
  type AliasKind,
  type AliasRow,
  type CreatePersonaParams,
  type PersonaSummary,
  type UpdateAliasParams,
  type UpdatePersonaParams,
} from './types.js';
