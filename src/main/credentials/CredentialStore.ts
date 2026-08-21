import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import type { ProviderConfigV1 } from '@echocue/contracts';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

interface CredentialsFileV1 {
  schemaVersion: 1;
  entries: Record<string, string>;
}

const PROVIDER_ID_RE = /^[a-z0-9_-]{1,64}$/;
const CRED_REF_PREFIX = 'safe-storage:';

export class CredentialEncryptionUnavailableError extends Error {
  constructor() {
    super('safeStorage encryption is not available on this system');
    this.name = 'CredentialEncryptionUnavailableError';
  }
}

export class CredentialStore {
  private readonly credentialsPath: string;
  private readonly tmpPath: string;
  private cache: CredentialsFileV1 | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly storage: SafeStorageLike,
  ) {
    this.credentialsPath = join(dataDir, 'config', 'credentials.json');
    this.tmpPath = `${this.credentialsPath}.tmp`;
  }

  static parseCredentialRef(ref: string): string | null {
    if (!ref.startsWith(CRED_REF_PREFIX)) return null;
    const providerId = ref.slice(CRED_REF_PREFIX.length);
    return PROVIDER_ID_RE.test(providerId) ? providerId : null;
  }

  static buildCredentialRef(providerId: string): string {
    return `${CRED_REF_PREFIX}${providerId}`;
  }

  async setCredential(providerId: string, apiKey: string): Promise<void> {
    if (!PROVIDER_ID_RE.test(providerId)) {
      throw new Error(`Invalid providerId format: must match [a-z0-9_-]{1,64}`);
    }
    if (!this.storage.isEncryptionAvailable()) {
      throw new CredentialEncryptionUnavailableError();
    }
    const encrypted = this.storage.encryptString(apiKey);
    const file = await this.readFile();
    file.entries[providerId] = encrypted.toString('base64');
    await this.writeFile(file);
    this.cache = file;
  }

  async getCredential(providerId: string): Promise<string | null> {
    const file = await this.readFile();
    const entry = file.entries[providerId];
    if (!entry) return null;
    const buf = Buffer.from(entry, 'base64');
    return this.storage.decryptString(buf);
  }

  hasCredential(providerId: string): boolean {
    if (!this.cache) return false;
    return Object.prototype.hasOwnProperty.call(this.cache.entries, providerId);
  }

  async deleteCredential(providerId: string): Promise<void> {
    const file = await this.readFile();
    if (!Object.prototype.hasOwnProperty.call(file.entries, providerId)) return;
    delete file.entries[providerId];
    await this.writeFile(file);
    this.cache = file;
  }

  async invalidateIfProviderChanged(
    oldConfig: ProviderConfigV1 | undefined,
    newConfig: ProviderConfigV1,
  ): Promise<void> {
    if (!oldConfig) return;
    if (oldConfig.providerId !== newConfig.providerId) return;
    const hostOrAdapterChanged =
      oldConfig.baseUrl !== newConfig.baseUrl ||
      oldConfig.adapterType !== newConfig.adapterType;
    if (hostOrAdapterChanged) {
      await this.deleteCredential(oldConfig.providerId);
    }
  }

  private async readFile(): Promise<CredentialsFileV1> {
    try {
      const content = await fs.readFile(this.credentialsPath, 'utf-8');
      const parsed = JSON.parse(content) as CredentialsFileV1;
      if (parsed.schemaVersion !== 1 || typeof parsed.entries !== 'object') {
        return this.emptyFile();
      }
      this.cache = parsed;
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return this.emptyFile();
      }
      // Corrupt file: treat as empty (fail-safe, never leak key)
      return this.emptyFile();
    }
  }

  private async writeFile(file: CredentialsFileV1): Promise<void> {
    await fs.mkdir(dirname(this.credentialsPath), { recursive: true });
    const content = JSON.stringify(file);
    let fd: fs.FileHandle | null = null;
    try {
      await fs.writeFile(this.tmpPath, content, 'utf-8');
      fd = await fs.open(this.tmpPath, 'r+');
      await fd.sync();
      await fd.close();
      fd = null;
      await fs.rename(this.tmpPath, this.credentialsPath);
    } catch (err) {
      if (fd) await fd.close().catch(() => {});
      await fs.unlink(this.tmpPath).catch(() => {});
      throw err;
    }
  }

  private emptyFile(): CredentialsFileV1 {
    return { schemaVersion: 1, entries: {} };
  }
}
