import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { AesGcmEnvelopeV1 } from './types.js';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class FieldEncryptor {
  constructor(
    private readonly dek: Buffer,
    private readonly keyVersion: string,
  ) {}

  encrypt(plaintext: Buffer, aad: string): Buffer {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.dek, nonce);
    cipher.setAAD(Buffer.from(aad, 'utf-8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const envelope: AesGcmEnvelopeV1 = {
      alg: 'AES-256-GCM',
      keyVersion: this.keyVersion,
      nonceB64: nonce.toString('base64'),
      ciphertextB64: ciphertext.toString('base64'),
      tagB64: tag.toString('base64'),
      aadVersion: '1',
    };

    return Buffer.from(JSON.stringify(envelope), 'utf-8');
  }

  decrypt(envelopeBlob: Buffer, aad: string): Buffer {
    const envelope = JSON.parse(envelopeBlob.toString('utf-8')) as AesGcmEnvelopeV1;
    if (envelope.alg !== 'AES-256-GCM') {
      throw new Error(`Unsupported algorithm: ${envelope.alg}`);
    }

    const nonce = Buffer.from(envelope.nonceB64, 'base64');
    const ciphertext = Buffer.from(envelope.ciphertextB64, 'base64');
    const tag = Buffer.from(envelope.tagB64, 'base64');

    const decipher = createDecipheriv('aes-256-gcm', this.dek, nonce);
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(aad, 'utf-8'));

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}

export function buildAad(
  tableName: string,
  primaryKey: string,
  columnOrContentType: string,
): string {
  return `${tableName}|${primaryKey}|${columnOrContentType}|1`;
}
