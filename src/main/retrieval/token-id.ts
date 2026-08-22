import { x86 } from 'murmurhash3js-revisited';

// abs(MurmurHash3_x86_32(UTF-8 bytes, seed=0)); must equal Python mmh3 on the
// same UTF-8 bytes. The library only accepts byte input, never a JS string.
export function tokenId(token: string): number {
  const hash = x86.hash32(Buffer.from(token, 'utf8'), 0);
  const signed = hash > 0x7fffffff ? hash - 0x100000000 : hash;
  return Math.abs(signed);
}
