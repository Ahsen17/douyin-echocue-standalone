import { randomBytes } from 'node:crypto';
import type { CredentialStore } from '../credentials/CredentialStore.js';

const DEK_BYTES = 32;
const HMAC_KEY_BYTES = 32;

export class CryptoKeyManager {
  private dekCache: Map<string, Buffer> = new Map();
  private hmacKeyCache: Map<string, Buffer> = new Map();

  constructor(private readonly credentialStore: CredentialStore) {}

  async ensureKeys(keyVersion: string): Promise<void> {
    const dekId = this.buildDekId(keyVersion);
    const hmacId = this.buildHmacId(keyVersion);

    const existingDek = await this.credentialStore.getCredential(dekId);
    if (!existingDek) {
      const dek = randomBytes(DEK_BYTES);
      await this.credentialStore.setCredential(dekId, dek.toString('base64'));
      this.dekCache.set(keyVersion, dek);
    } else {
      this.dekCache.set(keyVersion, Buffer.from(existingDek, 'base64'));
    }

    const existingHmac = await this.credentialStore.getCredential(hmacId);
    if (!existingHmac) {
      const hmacKey = randomBytes(HMAC_KEY_BYTES);
      await this.credentialStore.setCredential(hmacId, hmacKey.toString('base64'));
      this.hmacKeyCache.set(keyVersion, hmacKey);
    } else {
      this.hmacKeyCache.set(keyVersion, Buffer.from(existingHmac, 'base64'));
    }
  }

  getDek(keyVersion: string): Buffer {
    const dek = this.dekCache.get(keyVersion);
    if (!dek) {
      throw new Error(`DEK not loaded for version ${keyVersion}`);
    }
    return dek;
  }

  getHmacKey(keyVersion: string): Buffer {
    const hmacKey = this.hmacKeyCache.get(keyVersion);
    if (!hmacKey) {
      throw new Error(`HMAC key not loaded for version ${keyVersion}`);
    }
    return hmacKey;
  }

  private buildDekId(keyVersion: string): string {
    return `_echocue_dek_v${keyVersion}`;
  }

  private buildHmacId(keyVersion: string): string {
    return `_echocue_hmac_v${keyVersion}`;
  }
}
