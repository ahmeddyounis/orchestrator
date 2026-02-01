// Placeholder for crypto utility
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { MemoryError } from '@orchestrator/shared';

// Using AES-256-GCM. This is a good general-purpose choice.
// It's a NIST standard and widely used.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard
const SALT_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits for AES-256
const AUTH_TAG_LENGTH = 16; // GCM standard

export interface Crypto {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export function createCrypto(key: string): Crypto {
  if (!key) {
    throw new MemoryError('A valid encryption key is required.');
  }

  // We derive a key from the user-provided key using scrypt.
  // This adds some protection against weak keys. A salt is not strictly
  // necessary here as we're using the derived key directly, but we include
  // a fixed salt for reproducibility if we were to store the derived key.
  // For this implementation, we re-derive it each time, so the salt is fixed.
  const salt = Buffer.alloc(SALT_LENGTH, 'orchestrator-salt');
  const derivedKey = scryptSync(key, salt, KEY_LENGTH);

  const encrypt = (plaintext: string): string => {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // We'll store the iv, authTag, and ciphertext together in a single
    // string for easier storage in the database.
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  };

  const decrypt = (ciphertext: string): string => {
    try {
      const data = Buffer.from(ciphertext, 'base64');
      const iv = data.subarray(0, IV_LENGTH);
      const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

      const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (e: any) {
      throw new MemoryError(
        `Failed to decrypt data. The encryption key may be incorrect or the data may be corrupt.`,
        { cause: e },
      );
    }
  };

  return { encrypt, decrypt };
}
