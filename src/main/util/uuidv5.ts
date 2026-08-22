import { createHash } from 'node:crypto';

// Project namespace for deterministic Qdrant point ids (CONTRACT §4). Fixed once;
// changing it would orphan every existing point.
export const ECHOCUE_POINT_NAMESPACE_UUID = '6c65d7a3-9e42-4b1f-a5d8-0e7c3f2a9b16';

export function uuidv5(name: string, namespace: string = ECHOCUE_POINT_NAMESPACE_UUID): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1').update(namespaceBytes).update(name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
