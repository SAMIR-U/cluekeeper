import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L

export function randomCode(length = 6) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export const randomSecret = (bytes = 16) => randomBytes(bytes).toString('base64url');
export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Contenido de los QR/NFC de checkpoint: CK1.<checkpointId>.<secreto>
export const checkpointCode = (cp) => `CK1.${cp.id}.${cp.qr_secret}`;

export function verifyCheckpointCode(cp, code) {
  const parts = String(code ?? '').trim().split('.');
  return parts.length === 3 && parts[0] === 'CK1' && parts[1] === cp.id && safeEqual(parts[2], cp.qr_secret);
}
