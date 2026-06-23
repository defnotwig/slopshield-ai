import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, recommended for GCM

/**
 * Returns the 32-byte encryption key derived from the hex-encoded
 * OAUTH_ENCRYPTION_KEY environment variable.
 *
 * Throws a descriptive error if the variable is missing or empty.
 */
function getKey(): Buffer {
  const hex = process.env.OAUTH_ENCRYPTION_KEY;
  if (!hex || hex.trim() === '') {
    throw new Error(
      'OAUTH_ENCRYPTION_KEY environment variable is missing or empty. ' +
        'A 32-byte hex-encoded key is required for OAuth token encryption.',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @returns Encrypted string in the format `iv_hex:authTag_hex:ciphertext_hex`
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a string that was encrypted with {@link encrypt}.
 *
 * @param encrypted - The encrypted string in `iv_hex:authTag_hex:ciphertext_hex` format
 * @returns The original plaintext string
 */
export function decrypt(encrypted: string): string {
  const key = getKey();
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
