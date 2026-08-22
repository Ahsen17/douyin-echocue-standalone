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
  PersonaVersionNotFoundError,
  PersonaVersionImmutableError,
  PersonaContentDecryptionError,
} from './PersonaStore.js';
export type { PersonaStoreOptions } from './PersonaStore.js';
export {
  ALIAS_KINDS_V1,
  PERSONA_VERSION_STATUSES,
  type AliasInput,
  type AliasKind,
  type AliasRow,
  type CreateDraftParams,
  type CreatePersonaParams,
  type PersonaSummary,
  type PersonaVersionMeta,
  type PersonaVersionStatus,
  type UpdateAliasParams,
  type UpdatePersonaParams,
  type VersionComparison,
} from './types.js';
export { PersonaRouter } from './PersonaRouter.js';
export { createPersonaControlHandlers } from './persona-control-handlers.js';
export type { PersonaControlDeps, PersonaControlHandlers } from './persona-control-handlers.js';
export { wirePersonaControl } from './persona-control-ipc.js';
export type { PersonaControlIpcOptions } from './persona-control-ipc.js';
export type { PersonaRoute } from './PersonaRouter.js';
export {
  FUZZY_MATCH_THRESHOLD,
  PersonaRouterUnavailableError,
  routePersona,
  type AliasRoutingData,
  type PersonaRouteDecision,
  type PersonaRoutingData,
  type RouteCandidate,
  type RouteDecision,
} from './router.js';
