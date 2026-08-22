import type { QdrantClient } from '@qdrant/js-client-rest';
import { QDRANT_ALIAS_PRE_SET } from '../retrieval/bootstrap.js';
import { uuidv7 } from '../util/index.js';
import { CredentialStore } from '../credentials/index.js';
import type { SettingsStore } from '../config/index.js';
import type { AuditStoreWorker } from '../storage/index.js';
import type { PersonaStore } from '../persona/index.js';
import type { SafetyPolicyStore } from '../safety/index.js';
import type { QdrantSidecarManager } from '../qdrant/index.js';
import type { ServiceGateChecks, ServiceGateSettings } from './ServiceController.js';

export interface ServiceGateDependencies {
  settings: SettingsStore;
  credentials: CredentialStore;
  audit: AuditStoreWorker;
  persona: PersonaStore;
  safety: SafetyPolicyStore;
  qdrant: QdrantSidecarManager;
  qdrantClient: QdrantClient;
}

export function createLiveSessionWriter(deps: {
  audit: AuditStoreWorker;
  settings: SettingsStore;
}): (params: { roomReference: string; platformRoomId?: string }) => Promise<void> {
  return async (params) => {
    const settings = await deps.settings.get();
    deps.audit.createSession({
      sessionId: uuidv7(),
      roomReference: params.roomReference,
      ...(params.platformRoomId !== undefined ? { platformRoomId: params.platformRoomId } : {}),
      startedAt: new Date().toISOString(),
      ...(settings?.activeSafetyPolicyVersion !== undefined
        ? { safetyPolicyVersion: settings.activeSafetyPolicyVersion }
        : {}),
      ...(settings?.provider
        ? {
            providerId: settings.provider.providerId,
            adapterType: settings.provider.adapterType,
            modelId: settings.provider.modelId,
          }
        : {}),
    });
  };
}

export function createServiceGateChecks(deps: ServiceGateDependencies): ServiceGateChecks {
  return {
    async getSettings(): Promise<ServiceGateSettings | null> {
      const settings = await deps.settings.get();
      if (!settings?.roomReference || !settings.provider) return null;
      return {
        roomReference: settings.roomReference,
        providerCredentialRef: settings.provider.credentialRef,
      };
    },
    async getCredential(credentialRef: string): Promise<string | null> {
      const providerId = CredentialStore.parseCredentialRef(credentialRef);
      if (providerId === null) return null;
      return deps.credentials.getCredential(providerId);
    },
    async isAuditHealthy(): Promise<boolean> {
      return deps.audit.healthCheck();
    },
    async hasPublishedPersona(): Promise<boolean> {
      const principal = deps.persona.listPersonas().find((persona) => persona.isPrincipal);
      return principal !== undefined && principal.activeVersion !== null;
    },
    async hasPublishedSafetyPolicy(): Promise<boolean> {
      return deps.safety.listVersions().some((version) => version.status === 'PUBLISHED');
    },
    async isRetrievalReady(): Promise<boolean> {
      if (!(await deps.qdrant.isHealthy())) return false;
      try {
        return (await deps.qdrantClient.collectionExists(QDRANT_ALIAS_PRE_SET)).exists;
      } catch {
        return false;
      }
    },
  };
}
