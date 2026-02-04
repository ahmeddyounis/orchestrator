import { describe, it, expect } from 'vitest';
import { createCrypto } from './crypto';
import { MemoryError } from '@orchestrator/shared';

describe('createCrypto', () => {
  it('throws when key is empty', () => {
    expect(() => createCrypto('')).toThrow(MemoryError);
  });

  it('encrypt/decrypt roundtrip works', () => {
    const crypto = createCrypto('test-key');
    const plaintext = 'This is a secret message.';
    const ciphertext = crypto.encrypt(plaintext);
    expect(crypto.decrypt(ciphertext)).toBe(plaintext);
  });

  it('handles empty plaintext', () => {
    const crypto = createCrypto('test-key');
    const ciphertext = crypto.encrypt('');
    expect(crypto.decrypt(ciphertext)).toBe('');
  });

  it('handles unicode plaintext', () => {
    const crypto = createCrypto('test-key');
    const plaintext = '你好世界 🌍 مرحبا العالم';
    const ciphertext = crypto.encrypt(plaintext);
    expect(crypto.decrypt(ciphertext)).toBe(plaintext);
  });

  it('handles long plaintext', () => {
    const crypto = createCrypto('test-key');
    const plaintext = 'A'.repeat(20_000);
    const ciphertext = crypto.encrypt(plaintext);
    expect(crypto.decrypt(ciphertext)).toBe(plaintext);
  });

  it('fails to decrypt with wrong key', () => {
    const crypto1 = createCrypto('key-one');
    const crypto2 = createCrypto('key-two');
    const ciphertext = crypto1.encrypt('Secret data');
    expect(() => crypto2.decrypt(ciphertext)).toThrow(MemoryError);
  });

  it('fails to decrypt invalid base64', () => {
    const crypto = createCrypto('test-key');
    expect(() => crypto.decrypt('not-valid-base64!!!')).toThrow(MemoryError);
  });

  it('fails to decrypt truncated ciphertext', () => {
    const crypto = createCrypto('test-key');
    const ciphertext = crypto.encrypt('Hello');
    expect(() => crypto.decrypt(ciphertext.slice(0, 10))).toThrow(MemoryError);
  });

  it('fails to decrypt tampered ciphertext', () => {
    const crypto = createCrypto('test-key');
    const ciphertext = crypto.encrypt('Hello, World!');
    const buffer = Buffer.from(ciphertext, 'base64');
    buffer[Math.max(0, buffer.length - 5)] ^= 0xff;
    const tampered = buffer.toString('base64');
    expect(() => crypto.decrypt(tampered)).toThrow(MemoryError);
  });

  it('is consistent across instances for the same key', () => {
    const crypto1 = createCrypto('consistent-key');
    const crypto2 = createCrypto('consistent-key');
    const plaintext = 'Test message';
    const ciphertext = crypto1.encrypt(plaintext);
    expect(crypto2.decrypt(ciphertext)).toBe(plaintext);
  });
});

