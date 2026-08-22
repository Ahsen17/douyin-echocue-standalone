import { contextBridge, ipcRenderer } from 'electron'
import type {
  AliasRowV1,
  AuditGetWorkflowRequestV1,
  AuditSearchRequestV1,
  AuditSearchResponseV1,
  AuditSubmitLabelRequestV1,
  AuditSubmitLabelResponseV1,
  AuditWorkflowV1,
  ConfigUpdateRequestV1,
  ConfigViewV1,
  ConnectionTestResultV1,
  DiagnosticSummaryV1,
  OverlayPreferenceV1,
  PersonaDetailV1,
  PersonaSummaryV1,
  PersonaVersionMetaV1,
  SafetyPolicyVersionMetaV1,
  SafetyPolicyViewV1,
  SafetySaveDraftRequestV1,
  SafetySaveDraftResultV1,
  ServiceViewState,
  VersionComparisonV1,
} from '@echocue/contracts'
import { IpcChannel } from '../shared/ipc-channels.js'

const echocueApi = {
  window: {
    close: () => ipcRenderer.send(IpcChannel.WindowClose),
    minimize: () => ipcRenderer.send(IpcChannel.WindowMinimize),
    maximize: () => ipcRenderer.send(IpcChannel.WindowMaximize),
    onMaximizeChange: (cb: (isMax: boolean) => void) => {
      ipcRenderer.on(IpcChannel.WindowMaximizeChanged, (_e, v) => cb(v as boolean))
    },
  },
  service: {
    subscribe: (cb: (state: ServiceViewState) => void): (() => void) => {
      const listener = (_e: unknown, state: ServiceViewState) => cb(state)
      ipcRenderer.on(IpcChannel.ServiceStateChanged, listener)
      ipcRenderer.invoke(IpcChannel.ServiceStateSubscribe).catch(() => undefined)
      return () => {
        ipcRenderer.removeListener(IpcChannel.ServiceStateChanged, listener)
      }
    },
    start: () => ipcRenderer.invoke(IpcChannel.ServiceStart) as Promise<ServiceViewState>,
    stop: () => ipcRenderer.invoke(IpcChannel.ServiceStop) as Promise<ServiceViewState>,
  },
  provider: {
    setApiKey: (providerId: string, apiKey: string) =>
      ipcRenderer.invoke(IpcChannel.ProviderCredentialSet, {
        providerId,
        apiKey,
      }) as Promise<{ apiKeyConfigured: boolean }>,
    clearApiKey: (providerId: string) =>
      ipcRenderer.invoke(IpcChannel.ProviderCredentialClear, {
        providerId,
      }) as Promise<{ apiKeyConfigured: boolean }>,
    testConnection: () =>
      ipcRenderer.invoke(IpcChannel.ProviderCredentialTest) as Promise<ConnectionTestResultV1>,
  },
  config: {
    get: () => ipcRenderer.invoke(IpcChannel.ConfigGet) as Promise<ConfigViewV1>,
    update: (input: ConfigUpdateRequestV1) =>
      ipcRenderer.invoke(IpcChannel.ConfigUpdate, input) as Promise<ConfigViewV1>,
  },
  persona: {
    list: () => ipcRenderer.invoke(IpcChannel.PersonaList) as Promise<PersonaSummaryV1[]>,
    get: (personaId: string) =>
      ipcRenderer.invoke(IpcChannel.PersonaGet, { personaId }) as Promise<PersonaDetailV1>,
    create: (input: { displayName: string; aliases?: unknown[] }) =>
      ipcRenderer.invoke(IpcChannel.PersonaCreate, input) as Promise<PersonaSummaryV1>,
    delete: (personaId: string) =>
      ipcRenderer.invoke(IpcChannel.PersonaDelete, { personaId }) as Promise<void>,
    setPrincipal: (personaId: string) =>
      ipcRenderer.invoke(IpcChannel.PersonaSetPrincipal, { personaId }) as Promise<PersonaSummaryV1>,
    saveDraft: (input: { personaId: string; content?: string; fromVersion?: string }) =>
      ipcRenderer.invoke(IpcChannel.PersonaSaveDraft, input) as Promise<PersonaVersionMetaV1>,
    publish: (personaVersion: string) =>
      ipcRenderer.invoke(IpcChannel.PersonaPublish, { personaVersion }) as Promise<PersonaVersionMetaV1>,
    listVersions: (personaId: string) =>
      ipcRenderer.invoke(IpcChannel.PersonaListVersions, { personaId }) as Promise<PersonaVersionMetaV1[]>,
    compare: (a: string, b: string) =>
      ipcRenderer.invoke(IpcChannel.PersonaCompare, { a, b }) as Promise<VersionComparisonV1>,
    updateAliases: (personaId: string, aliases: { aliasText: string; aliasKind: string; enabled?: boolean }[]) =>
      ipcRenderer.invoke(IpcChannel.PersonaUpdateAliases, {
        personaId,
        aliases,
      }) as Promise<AliasRowV1[]>,
  },
  safety: {
    get: () => ipcRenderer.invoke(IpcChannel.SafetyGet) as Promise<SafetyPolicyViewV1>,
    saveDraft: (input: SafetySaveDraftRequestV1) =>
      ipcRenderer.invoke(IpcChannel.SafetySaveDraft, input) as Promise<SafetySaveDraftResultV1>,
    publish: (safetyPolicyVersion: string) =>
      ipcRenderer.invoke(IpcChannel.SafetyPublish, { safetyPolicyVersion }) as Promise<SafetyPolicyVersionMetaV1>,
  },
  diagnostics: {
    getSummary: () =>
      ipcRenderer.invoke(IpcChannel.DiagnosticsGetSummary) as Promise<DiagnosticSummaryV1>,
  },
  audit: {
    search: (req: AuditSearchRequestV1) =>
      ipcRenderer.invoke(IpcChannel.AuditSearch, req) as Promise<AuditSearchResponseV1>,
    getWorkflow: (req: AuditGetWorkflowRequestV1) =>
      ipcRenderer.invoke(IpcChannel.AuditGetWorkflow, req) as Promise<AuditWorkflowV1>,
    submitLabel: (req: AuditSubmitLabelRequestV1) =>
      ipcRenderer.invoke(IpcChannel.AuditSubmitLabel, req) as Promise<AuditSubmitLabelResponseV1>,
  },
  overlay: {
    updatePreferences: (prefs: OverlayPreferenceV1) =>
      ipcRenderer.invoke(IpcChannel.OverlayPreferenceUpdate, prefs) as Promise<OverlayPreferenceV1>,
  },
}

export type EchocueApi = typeof echocueApi

contextBridge.exposeInMainWorld('echocue', echocueApi)
