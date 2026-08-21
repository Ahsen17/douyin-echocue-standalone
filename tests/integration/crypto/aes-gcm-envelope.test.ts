import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes, createHash } from 'node:crypto';
import { FieldEncryptor, buildAad } from '../../../src/main/crypto/field-encryptor.js';
import { contentHmac } from '../../../src/main/crypto/content-hmac.js';

function makeDek(): Buffer {
  return randomBytes(32);
}

describe('FieldEncryptor', () => {
  let dek: Buffer;
  let encryptor: FieldEncryptor;
  const aad = buildAad('audit_snapshot', 'snap-001', 'envelope');

  beforeEach(() => {
    dek = makeDek();
    encryptor = new FieldEncryptor(dek, '1');
  });

  it('round-trips plaintext', () => {
    const plain = Buffer.from('hello world');
    const blob = encryptor.encrypt(plain, aad);
    const result = encryptor.decrypt(blob, aad);
    expect(result.toString('utf-8')).toBe('hello world');
  });

  it('round-trips empty buffer', () => {
    const plain = Buffer.alloc(0);
    const blob = encryptor.encrypt(plain, aad);
    const result = encryptor.decrypt(blob, aad);
    expect(result.length).toBe(0);
  });

  it('includes correct envelope fields', () => {
    const blob = encryptor.encrypt(Buffer.from('x'), aad);
    const env = JSON.parse(blob.toString('utf-8'));
    expect(env.alg).toBe('AES-256-GCM');
    expect(env.keyVersion).toBe('1');
    expect(env.aadVersion).toBe('1');
    expect(typeof env.nonceB64).toBe('string');
    expect(typeof env.ciphertextB64).toBe('string');
    expect(typeof env.tagB64).toBe('string');
  });

  it('rejects tampered ciphertext', () => {
    const blob = encryptor.encrypt(Buffer.from('secret'), aad);
    const env = JSON.parse(blob.toString('utf-8'));
    const ct = Buffer.from(env.ciphertextB64, 'base64');
    ct[0] ^= 0xff;
    env.ciphertextB64 = ct.toString('base64');
    const tampered = Buffer.from(JSON.stringify(env), 'utf-8');
    expect(() => encryptor.decrypt(tampered, aad)).toThrow();
  });

  it('rejects wrong AAD (cross-column replay)', () => {
    const blob = encryptor.encrypt(Buffer.from('data'), aad);
    const wrongAad = buildAad('audit_snapshot', 'snap-001', 'other_column');
    expect(() => encryptor.decrypt(blob, wrongAad)).toThrow();
  });

  it('rejects tampered auth tag', () => {
    const blob = encryptor.encrypt(Buffer.from('data'), aad);
    const env = JSON.parse(blob.toString('utf-8'));
    const tag = Buffer.from(env.tagB64, 'base64');
    tag[0] ^= 0x01;
    env.tagB64 = tag.toString('base64');
    const tampered = Buffer.from(JSON.stringify(env), 'utf-8');
    expect(() => encryptor.decrypt(tampered, aad)).toThrow();
  });
});

describe('contentHmac', () => {
  const hmacKey = randomBytes(32);

  it('produces deterministic hex output for same input', () => {
    const h1 = contentHmac({ foo: 'bar', n: 42 }, hmacKey);
    const h2 = contentHmac({ foo: 'bar', n: 42 }, hmacKey);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs from keyless SHA-256', () => {
    const content = { x: 1 };
    const hmacResult = contentHmac(content, hmacKey);
    const sha256 = createHash('sha256')
      .update(JSON.stringify(content), 'utf-8')
      .digest('hex');
    expect(hmacResult).not.toBe(sha256);
  });

  it('changes with different key', () => {
    const key2 = randomBytes(32);
    const h1 = contentHmac({ a: 1 }, hmacKey);
    const h2 = contentHmac({ a: 1 }, key2);
    expect(h1).not.toBe(h2);
  });
});

describe('key independence', () => {
  it('DEK and HMAC key are not the same value when both generated randomly', () => {
    const dek = randomBytes(32);
    const hmacKey = randomBytes(32);
    expect(dek.equals(hmacKey)).toBe(false);
  });
});
