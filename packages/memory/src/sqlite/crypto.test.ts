import { describe, it, expect } from 'vitest';
import { createCrypto } from './crypto';

describe('Crypto module', () => {
  describe('createCrypto', () => {
    it('should throw an error if key is empty', () => {
      expect(() => createCrypto('')).toThrow(/encryption key is required/i);
    });

    it('should throw an error if key is not provided', () => {
      // @ts-expect-error Testing runtime behavior with undefined
      expect(() => createCrypto(undefined)).toThrow(/encryption key is required/i);
    });

    it('should return an object with encrypt and decrypt functions', () => {
      const crypto = createCrypto('test-key');
      expect(crypto).toHaveProperty('encrypt');
      expect(crypto).toHaveProperty('decrypt');
      expect(typeof crypto.encrypt).toBe('function');
      expect(typeof crypto.decrypt).toBe('function');
    });
  });

  describe('encrypt', () => {
    it('should encrypt plaintext and return a base64 string', () => {
      const crypto = createCrypto('test-key');
      const plaintext = 'Hello, World!';
      const ciphertext = crypto.encrypt(plaintext);

      expect(typeof ciphertext).toBe('string');
      // Verify it's valid base64
      expect(() => Buffer.from(ciphertext, 'base64')).not.toThrow();
      // The ciphertext should not contain the plaintext
      expect(ciphertext).not.toContain(plaintext);
    });

    it('should produce different ciphertext for the same plaintext (due to random IV)', () => {
      const crypto = createCrypto('test-key');
      const plaintext = 'Hello, World!';

      const ciphertext1 = crypto.encrypt(plaintext);
      const ciphertext2 = crypto.encrypt(plaintext);

      expect(ciphertext1).not.toBe(ciphertext2);
    });

    it('should handle empty string plaintext', () => {
      const crypto = createCrypto('test-key');
      const ciphertext = crypto.encrypt('');
      const decrypted = crypto.decrypt(ciphertext);
      expect(decrypted).toBe('');
    });

    it('should handle unicode characters', () => {
      const crypto = createCrypto('test-key');
      const plaintext = '你好世界 🌍 مرحبا العالم';
      const ciphertext = crypto.encrypt(plaintext);
      const decrypted = crypto.decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle long plaintext', () => {
      const crypto = createCrypto('test-key');
      const plaintext = 'A'.repeat(100000);
      const ciphertext = crypto.encrypt(plaintext);
      const decrypted = crypto.decrypt(ciphertext);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe('decrypt', () => {
    it('should decrypt ciphertext back to original plaintext', () => {
      const crypto = createCrypto('my-secret-key');
      const plaintext = 'This is a secret message.';

      const ciphertext = crypto.encrypt(plaintext);
      const decrypted = crypto.decrypt(ciphertext);

      expect(decrypted).toBe(plaintext);
    });

    it('should fail to decrypt with wrong key', () => {
      const crypto1 = createCrypto('key-one');
      const crypto2 = createCrypto('key-two');

      const plaintext = 'Secret data';
      const ciphertext = crypto1.encrypt(plaintext);

      expect(() => crypto2.decrypt(ciphertext)).toThrow(/decrypt/i);
    });

    it('should fail to decrypt invalid base64', () => {
      const crypto = createCrypto('test-key');
      expect(() => crypto.decrypt('not-valid-base64!!!')).toThrow(/decrypt/i);
    });

    it('should fail to decrypt truncated ciphertext', () => {
      const crypto = createCrypto('test-key');
      const ciphertext = crypto.encrypt('Hello');
      // Truncate the ciphertext
      const truncated = ciphertext.slice(0, 10);
      expect(() => crypto.decrypt(truncated)).toThrow(/decrypt/i);
    });

    it('should fail to decrypt tampered ciphertext', () => {
      const crypto = createCrypto('test-key');
      const ciphertext = crypto.encrypt('Hello, World!');

      // Tamper with the ciphertext by modifying a character in the middle
      const buffer = Buffer.from(ciphertext, 'base64');
      buffer[buffer.length - 5] ^= 0xff; // Flip bits
      const tampered = buffer.toString('base64');

      expect(() => crypto.decrypt(tampered)).toThrow(/decrypt/i);
    });
  });

  describe('key derivation consistency', () => {
    it('should produce consistent results with the same key', () => {
      const crypto1 = createCrypto('consistent-key');
      const crypto2 = createCrypto('consistent-key');

      const plaintext = 'Test message for consistency check';
      const ciphertext = crypto1.encrypt(plaintext);

      // crypto2 should be able to decrypt what crypto1 encrypted
      expect(crypto2.decrypt(ciphertext)).toBe(plaintext);
