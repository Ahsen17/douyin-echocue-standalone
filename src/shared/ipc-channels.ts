// Single source of IPC channel names shared by main, preload, and renderer.
// Channel values are transport details, not domain schema, so they live outside
// the contract package (which must stay byte-identical to docs/contracts-v1.ts).
export const IpcChannel = {
  WindowClose: 'window:close',
  WindowMinimize: 'window:minimize',
  WindowMaximize: 'window:maximize',
  WindowMaximizeChanged: 'window:maximize-changed',
  ServiceStart: 'service.start',
  ServiceStop: 'service.stop',
  ServiceStateSubscribe: 'service.state.subscribe',
  ServiceStateChanged: 'service.state.changed',
  ConfigGet: 'config.get',
  ConfigUpdate: 'config.update',
  ProviderCredentialSet: 'provider.credential.set',
  ProviderCredentialClear: 'provider.credential.clear',
  ProviderCredentialTest: 'provider.credential.test',
  PersonaList: 'persona.list',
  PersonaGet: 'persona.get',
  PersonaCreate: 'persona.create',
  PersonaDelete: 'persona.delete',
  PersonaSetPrincipal: 'persona.setPrincipal',
  PersonaSaveDraft: 'persona.saveDraft',
  PersonaPublish: 'persona.publish',
  PersonaListVersions: 'persona.listVersions',
  PersonaCompare: 'persona.compare',
  PersonaUpdateAliases: 'persona.updateAliases',
  SafetyGet: 'safety.get',
  SafetySaveDraft: 'safety.saveDraft',
  SafetyPublish: 'safety.publish',
  DiagnosticsGetSummary: 'diagnostics.getSummary',
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];
