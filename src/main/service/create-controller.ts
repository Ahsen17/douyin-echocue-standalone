import { join } from 'node:path';
import { QdrantClient } from '@qdrant/js-client-rest';
import { SettingsStore } from '../config/index.js';
import { CredentialStore, type SafeStorageLike } from '../credentials/index.js';
import { CryptoKeyManager } from '../crypto/index.js';
import { AuditStoreWorker, type MigrationFile } from '../storage/index.js';
import { PersonaStore } from '../persona/index.js';
import { SafetyPolicyStore } from '../safety/index.js';
import { QDRANT_HTTP_PORT, QDRANT_LOOPBACK_HOST, QdrantSidecarManager } from '../qdrant/index.js';
import { DouyinLiveSidecarManager, DouyinLiveWsAdapter } from '../douyin/index.js';
import { ServiceController } from './ServiceController.js';
import { createLiveSessionWriter, createServiceGateChecks } from './service-gate.js';
import { ServiceStateMachine } from './ServiceStateMachine.js';

export interface CreateServiceControllerOptions {
  dataDir: string;
  safeStorage: SafeStorageLike;
  douyinLiveBinaryPath: string;
  qdrantBinaryPath: string;
  migrationPath: string;
  keyVersion: string;
  cleanupOnStop: () => void;
}

export interface CreatedServiceController {
  readonly controller: ServiceController;
  readonly stateMachine: ServiceStateMachine;
  readonly shutdown: () => void;
}

export async function createServiceController(
  options: CreateServiceControllerOptions,
): Promise<CreatedServiceController> {
  const settings = new SettingsStore(options.dataDir);
  const credentials = new CredentialStore(options.dataDir, options.safeStorage);
  const keyManager = new CryptoKeyManager(credentials);
  await keyManager.ensureKeys(options.keyVersion);

  const migrations: MigrationFile[] = [{ version: 1, path: options.migrationPath }];
  const dbPath = join(options.dataDir, 'audit', 'audit.sqlite');
  const audit = new AuditStoreWorker({
    dbPath,
    migrations,
    keyManager,
    keyVersion: options.keyVersion,
  });
  const persona = new PersonaStore({ dbPath, migrations, keyManager, keyVersion: options.keyVersion });
  const safety = new SafetyPolicyStore({
    dbPath,
    migrations,
    keyManager,
    keyVersion: options.keyVersion,
    settingsStore: settings,
  });

  const douyinSidecar = new DouyinLiveSidecarManager({
    binaryPath: options.douyinLiveBinaryPath,
    dataDir: join(options.dataDir, 'douyin'),
  });
  const qdrantSidecar = new QdrantSidecarManager({
    binaryPath: options.qdrantBinaryPath,
    dataDir: join(options.dataDir, 'qdrant'),
  });
  const qdrantClient = new QdrantClient({
    url: `http://${QDRANT_LOOPBACK_HOST}:${QDRANT_HTTP_PORT}`,
  });

  const stateMachine = new ServiceStateMachine();
  const checks = createServiceGateChecks({
    settings,
    credentials,
    audit,
    persona,
    safety,
    qdrant: qdrantSidecar,
    qdrantClient,
  });
  const createLiveSession = createLiveSessionWriter({ audit, settings });
  const controller = new ServiceController({
    stateMachine,
    sidecar: douyinSidecar,
    createAdapter: (roomReference) => new DouyinLiveWsAdapter({ roomReference }),
    checks,
    createLiveSession,
    cleanupOnStop: options.cleanupOnStop,
  });

  const shutdown = () => {
    audit.close();
    persona.close();
    safety.close();
  };

  return { controller, stateMachine, shutdown };
}
