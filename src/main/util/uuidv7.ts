import { randomBytes } from 'node:crypto';

// Mirrors the contract's uuidV7 regex (schemas.ts keeps it as a non-exported
// constant); the settings.activeSafetyPolicyVersion validation depends on it.
export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Version/variant bits are pinned so output always matches the contract's
// uuidV7 regex (settings.activeSafetyPolicyVersion validation depends on it).
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  let ms = BigInt(now);
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
