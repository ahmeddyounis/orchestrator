import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { join } from './path';
import * as os from 'os';
import {
  createRunDir,
  getRunArtifactPaths,
  writeManifest,
  Manifest,
  MANIFEST_VERSION,
  createArtifactCrypto,
  writeArtifact,
  readArtifact,
  appendArtifact,
} from './artifacts';

describe('artifacts', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('createRunDir creates directory structure', async () => {
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'orch-test-'));
    const runId = 'test-run-123';

    const paths = await createRunDir(tmpDir, runId);

    // Verify directories exist
    const runDirExists = await fs
      .stat(paths.root)
      .then(() => true)
      .catch(() => false);
    const toolLogsDirExists = await fs
      .stat(paths.toolLogsDir)
      .then(() => true)
      .catch(() => false);
    const patchesDirExists = await fs
      .stat(paths.patchesDir)
      .then(() => true)
      .catch(() => false);

    expect(runDirExists).toBe(true);
    expect(toolLogsDirExists).toBe(true);
    expect(patchesDirExists).toBe(true);

    // Verify paths structure
    expect(paths.trace).toBe(join(tmpDir, '.orchestrator/runs', runId, 'trace.jsonl'));
    expect(paths.manifest).toBe(join(tmpDir, '.orchestrator/runs', runId, 'manifest.json'));
  });

  it('getRunArtifactPaths returns correct paths without creating', () => {
    const base = '/tmp/project';
    const runId = 'abc';
    const paths = getRunArtifactPaths(base, runId);

    expect(paths.root).toBe(join(base, '.orchestrator/runs', runId));
    expect(paths.trace).toBe(join(base, '.orchestrator/runs', runId, 'trace.jsonl'));
    expect(paths.toolLogsDir).toBe(join(base, '.orchestrator/runs', runId, 'tool_logs'));
    expect(paths.patchesDir).toBe(join(base, '.orchestrator/runs', runId, 'patches'));
  });

  it('writeManifest writes the manifest file', async () => {
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'orch-test-'));
    const runId = 'manifest-test';
    const paths = await createRunDir(tmpDir, runId);

    const manifest: Manifest = {
      schemaVersion: MANIFEST_VERSION,
      runId,
      startedAt: new Date().toISOString(),
      command: 'run',
      repoRoot: tmpDir,
      artifactsDir: paths.root,
      tracePath: 'trace.jsonl',
      summaryPath: 'summary.json',
      effectiveConfigPath: 'effective-config.json',
      patchPaths: [],
      contextPaths: [],
      toolLogPaths: [],
      verificationPaths: [],
    };

    await writeManifest(paths.manifest, manifest);

    const content = await fs.readFile(paths.manifest, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed).toEqual(manifest);
  });
});

describe('createArtifactCrypto', () => {
  const TEST_KEY = 'test-encryption-key-for-unit-tests';

  it('throws if key is empty', () => {
    expect(() => createArtifactCrypto('')).toThrow('Artifact encryption key is required');
  });

  it('throws an Error instance with the correct message for empty string key', () => {
    expect(() => createArtifactCrypto('')).toThrow(Error);
    expect(() => createArtifactCrypto('')).toThrow('Artifact encryption key is required');
  });

  describe('new format (v1) round-trip', () => {
    it('encryptBuffer / decryptBuffer round-trips binary data', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const original = Buffer.from('hello, encrypted world!');
      const encrypted = crypto.encryptBuffer(original);
      const decrypted = crypto.decryptBuffer(encrypted);
      expect(decrypted).toEqual(original);
    });

    it('encrypt / decrypt round-trips a UTF-8 string', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const plaintext = 'The quick brown fox jumps over the lazy dog 🦊';
      const ciphertext = crypto.encrypt(plaintext);
      expect(crypto.decrypt(ciphertext)).toBe(plaintext);
    });

    it('produces different ciphertext for the same input (random salt+iv)', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const data = Buffer.from('determinism check');
      const a = crypto.encryptBuffer(data);
      const b = crypto.encryptBuffer(data);
      // Both decrypt to the same plaintext
      expect(crypto.decryptBuffer(a)).toEqual(data);
      expect(crypto.decryptBuffer(b)).toEqual(data);
      // But their ciphertext differs (different random salt + IV)
      expect(a.equals(b)).toBe(false);
    });

    it('encrypted buffer starts with version byte 0x01', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const encrypted = crypto.encryptBuffer(Buffer.from('version check'));
      expect(encrypted[0]).toBe(0x01);
    });

    it('decryption with the wrong key fails', () => {
      const crypto1 = createArtifactCrypto(TEST_KEY);
      const crypto2 = createArtifactCrypto('different-key');
      const encrypted = crypto1.encryptBuffer(Buffer.from('secret'));
      expect(() => crypto2.decryptBuffer(encrypted)).toThrow();
    });

    it('round-trips empty buffer', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const original = Buffer.alloc(0);
      const encrypted = crypto.encryptBuffer(original);
      const decrypted = crypto.decryptBuffer(encrypted);
      expect(decrypted).toEqual(original);
    });
  });

  describe('legacy format backward compatibility', () => {
    /**
     * Produces a buffer in the legacy format (pre-v1):
     *   [iv (12 bytes), authTag (16 bytes), ciphertext]
     * Key derivation uses the static salt 'orchestrator-artifact-salt'.
     */
    function encryptLegacy(key: string, data: Buffer): Buffer {
      const LEGACY_SALT = Buffer.from('orchestrator-artifact-salt');
      const derivedKey = scryptSync(key, LEGACY_SALT, 32);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([iv, authTag, encrypted]);
    }

    it('decrypts a legacy-format buffer', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const original = Buffer.from('legacy payload');
      const legacyBuf = encryptLegacy(TEST_KEY, original);
      const decrypted = crypto.decryptBuffer(legacyBuf);
      expect(decrypted).toEqual(original);
    });

    it('decrypts a legacy-format string via decrypt()', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const plaintext = 'legacy string content';
      const legacyBuf = encryptLegacy(TEST_KEY, Buffer.from(plaintext, 'utf8'));
      const ciphertext = legacyBuf.toString('base64');
      expect(crypto.decrypt(ciphertext)).toBe(plaintext);
    });

    it('legacy-format decryption works regardless of first byte value', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const original = Buffer.from('compat check');
      const legacyBuf = encryptLegacy(TEST_KEY, original);
      const decrypted = crypto.decryptBuffer(legacyBuf);
      expect(decrypted).toEqual(original);
    });

    it('backward-compatibility contract: decrypts a blob keyed with the old static salt', () => {
      // Manually derive the key exactly as the old code did
      const OLD_STATIC_SALT = Buffer.from('orchestrator-artifact-salt');
      const derivedKey = scryptSync(TEST_KEY, OLD_STATIC_SALT, 32);

      // Encrypt a known plaintext using that derived key (old format: no version byte)
      const plaintext = 'backward-compat contract payload 🔐';
      const data = Buffer.from(plaintext, 'utf8');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Old layout: [iv (12), authTag (16), ciphertext]
      const legacyBlob = Buffer.concat([iv, authTag, encrypted]);

      // The current createArtifactCrypto must be able to decrypt this
      const crypto = createArtifactCrypto(TEST_KEY);
      const result = crypto.decryptBuffer(legacyBlob);
      expect(result.toString('utf8')).toBe(plaintext);
    });
  });

  describe('static-salt format round-trip sanity check', () => {
    it('encrypts with legacy static-salt format and decrypts via current code', () => {
      const LEGACY_SALT = Buffer.from('orchestrator-artifact-salt');
      const plaintext = 'round-trip sanity check payload';
      const data = Buffer.from(plaintext, 'utf8');

      // Manually encrypt using the old static-salt format (no version byte)
      const derivedKey = scryptSync(TEST_KEY, LEGACY_SALT, 32);
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
      const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const legacyCiphertext = Buffer.concat([iv, authTag, encrypted]);

      // Decrypt using the current createArtifactCrypto which should detect legacy format
      const crypto = createArtifactCrypto(TEST_KEY);
      const decrypted = crypto.decryptBuffer(legacyCiphertext);
      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    it('two encryptions of the same plaintext produce different ciphertexts', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const plaintext = 'identical input for uniqueness check';
      const ciphertext1 = crypto.encrypt(plaintext);
      const ciphertext2 = crypto.encrypt(plaintext);

      // Both must decrypt back to the original
      expect(crypto.decrypt(ciphertext1)).toBe(plaintext);
      expect(crypto.decrypt(ciphertext2)).toBe(plaintext);
      // Ciphertexts must differ due to random IV/salt per encryption
      expect(ciphertext1).not.toBe(ciphertext2);
    });
  });

  describe('corrupt / truncated ciphertext rejection', () => {
    it('rejects a buffer that is too short', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const tooShort = Buffer.alloc(10); // less than IV + authTag + 1
      expect(() => crypto.decryptBuffer(tooShort)).toThrow(/too short/);
    });

    it('rejects a v1-format buffer that is truncated after the version byte', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const encrypted = crypto.encryptBuffer(Buffer.from('test'));
      // Truncate to just version + partial salt (less than MIN_V1_LENGTH)
      const truncated = encrypted.subarray(0, 20);
      expect(() => crypto.decryptBuffer(truncated)).toThrow();
    });

    it('rejects ciphertext with a flipped bit in the auth tag', () => {
      const crypto = createArtifactCrypto(TEST_KEY);
      const encrypted = crypto.encryptBuffer(Buffer.from('tamper test'));
      // v1 layout: [version(1), salt(16), iv(12), authTag(16), ciphertext]
      // authTag starts at offset 1 + 16 + 12 = 29
      const corrupted = Buffer.from(encrypted);
      corrupted[29] ^= 0xff; // flip bits in first byte of authTag
      expect(() => crypto.decryptBuffer(corrupted)).toThrow();
    });
  });

  describe('writeArtifact / readArtifact round-trip', () => {
    let tmpDir: string;

    afterEach(async () => {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('writes encrypted content and reads it back with the same crypto instance', async () => {
      tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'orch-artifact-rw-'));
      const crypto = createArtifactCrypto(TEST_KEY);
      const content = 'writeArtifact / readArtifact round-trip payload 🔒';
      const filePath = join(tmpDir, 'test-artifact.txt');

      const writtenPath = await writeArtifact(filePath, content, crypto);
      expect(writtenPath).toBe(filePath + '.enc');

      const result = await readArtifact(filePath, crypto);
      expect(result).toBe(content);
    });
  });

  describe('appendArtifact with encryption', () => {
    let tmpDir: string;

    afterEach(async () => {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('writes initial content, appends more, and reads back the concatenated result', async () => {
      tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'orch-artifact-append-'));
      const crypto = createArtifactCrypto(TEST_KEY);
      const filePath = join(tmpDir, 'append-test.txt');
      const initial = 'first chunk | ';
      const appended = 'second chunk 🔗';

      await writeArtifact(filePath, initial, crypto);
      await appendArtifact(filePath, appended, crypto);

      const result = await readArtifact(filePath, crypto);
      expect(result).toBe(initial + appended);
    });
  });
});
