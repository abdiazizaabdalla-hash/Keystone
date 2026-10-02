import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

/**
 * Symmetric key used to encrypt sensitive third-party credentials before
 * they're stored in the database -- currently a connected Helcim
 * merchant's api-token. Set HELCIM_TOKEN_ENCRYPTION_KEY in the
 * environment to a random 32-byte value, base64-encoded
 * (`openssl rand -base64 32`). If it's set to something else, we hash it
 * down to 32 bytes rather than fail outright — but a real random key is
 * strongly preferred.
 */
function getKey(): Buffer {
  const raw = process.env.HELCIM_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'HELCIM_TOKEN_ENCRYPTION_KEY is not set — cannot encrypt/decrypt stored payment credentials.'
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length === 32) return buf;
  return crypto.createHash('sha256').update(raw).digest();
}

/** Encrypts a secret for storage. Returns "iv.authTag.ciphertext", each base64. */
export function encryptSecret(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((b) => b.toString('base64')).join('.');
}

/** Reverses encryptSecret(). Throws if the value is malformed or the key doesn't match. */
export function decryptSecret(stored: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = stored.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted value');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}
