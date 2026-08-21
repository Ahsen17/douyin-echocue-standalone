export interface AesGcmEnvelopeV1 {
  alg: 'AES-256-GCM';
  keyVersion: string;
  nonceB64: string;
  ciphertextB64: string;
  tagB64: string;
  aadVersion: '1';
}
