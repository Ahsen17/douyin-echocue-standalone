import { createHmac } from 'node:crypto';

export function contentHmac(content: unknown, hmacKey: Buffer): string {
  const canonicalJson = JSON.stringify(content);
  return createHmac('sha256', hmacKey)
    .update(canonicalJson, 'utf-8')
    .digest('hex');
}
