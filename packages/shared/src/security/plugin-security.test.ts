import { describe, it, expect } from 'vitest';
import {
  generateSigningKeyPair,
  getKeyFingerprint,
  calculateContentHash,
  signPluginContent,
  verifyPluginSignature,
  validatePermissionManifest,
  checkPermissions,
  DEFAULT_UNTRUSTED_PERMISSIONS,
  DEFAULT_TRUSTED_PERMISSIONS,
  type PluginPermissions,
  type PermissionManifest,
} from './plugin-security';

describe('Plugin Security', () => {
  describe('Key Generation', () => {
    it('should generate a valid RSA key pair', () => {
      const { publicKey, privateKey } = generateSigningKeyPair();

      expect(publicKey).toContain('-----BEGIN PUBLIC KEY-----');
      expect(privateKey).toContain('-----BEGIN PRIVATE KEY-----');
    });

    it('should generate unique key pairs', () => {
      const pair1 = generateSigningKeyPair();
      const pair2 = generateSigningKeyPair();

      expect(pair1.publicKey).not.toBe(pair2.publicKey);
      expect(pair1.privateKey).not.toBe(pair2.privateKey);
    });
  });

  describe('Key Fingerprint', () => {
    it('should generate consistent fingerprints', () => {
      const { publicKey } = generateSigningKeyPair();
      const fingerprint1 = getKeyFingerprint(publicKey);
      const fingerprint2 = getKeyFingerprint(publicKey);

      expect(fingerprint1).toBe(fingerprint2);
      expect(fingerprint1).toHaveLength(64); // SHA-256 hex
    });

    it('should generate different fingerprints for different keys', () => {
      const { publicKey: key1 } = generateSigningKeyPair();
      const { publicKey: key2 } = generateSigningKeyPair();

      expect(getKeyFingerprint(key1)).not.toBe(getKeyFingerprint(key2));
    });
  });

  describe('Content Hash', () => {
    it('should generate consistent hashes', () => {
      const content = 'test plugin content';
      const hash1 = calculateContentHash(content);
      const hash2 = calculateContentHash(content);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different content', () => {
      expect(calculateContentHash('content1')).not.toBe(calculateContentHash('content2'));
    });
  });

  describe('Signing and Verification', () => {
    it('should sign and verify content successfully', () => {
      const { publicKey, privateKey } = generateSigningKeyPair();
      const content = 'plugin code content';

      const signature = signPluginContent(content, privateKey, publicKey);
      const trustedKeys = new Map([[signature.keyFingerprint, publicKey]]);

      const result = verifyPluginSignature(content, signature, trustedKeys);

      expect(result.valid).toBe(true);
      expect(result.keyFingerprint).toBe(signature.keyFingerprint);
    });

    it('should fail verification with tampered content', () => {
      const { publicKey, privateKey } = generateSigningKeyPair();
      const originalContent = 'original content';
      const tamperedContent = 'tampered content';

      const signature = signPluginContent(originalContent, privateKey, publicKey);
      const trustedKeys = new Map([[signature.keyFingerprint, publicKey]]);

      const result = verifyPluginSignature(tamperedContent, signature, trustedKeys);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('hash mismatch');
    });

    it('should fail verification with unknown key', () => {
      const { publicKey, privateKey } = generateSigningKeyPair();
      const content = 'plugin content';

      const signature = signPluginContent(content, privateKey, publicKey);
      const trustedKeys = new Map<string, string>(); // Empty - no trusted keys

      const result = verifyPluginSignature(content, signature, trustedKeys);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unknown signing key');
    });
  });

  describe('Permission Manifest Validation', () => {
    it('should validate a valid permission manifest', () => {
      const manifest: PermissionManifest = {
        schemaVersion: 1,
        required: {
          'network:http': true,
          'environment:read': true,
        },
      };

      expect(validatePermissionManifest(manifest)).toBe(true);
    });

    it('should reject invalid permission manifest', () => {
      expect(validatePermissionManifest(null)).toBe(false);
      expect(validatePermissionManifest({})).toBe(false);
      expect(validatePermissionManifest({ required: 'invalid' })).toBe(false);
    });
  });

  describe('Permission Checking', () => {
    it('should satisfy permissions when all required are granted', () => {
      const required: PluginPermissions = {
        'network:http': true,
        'environment:read': true,
      };
      const granted: PluginPermissions = {
        'network:http': true,
        'environment:read': true,
        'filesystem:read': true,
      };

      const result = checkPermissions(required, granted);

      expect(result.satisfied).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should report missing permissions', () => {
      const required: PluginPermissions = {
        'network:http': true,
        'process:spawn': true,
      };
      const granted: PluginPermissions = {
        'network:http': true,
      };

      const result = checkPermissions(required, granted);

      expect(result.satisfied).toBe(false);
      expect(result.missing).toContain('process:spawn');
    });
  });

  describe('Default Permissions', () => {
    it('should have restrictive defaults for untrusted plugins', () => {
      expect(DEFAULT_UNTRUSTED_PERMISSIONS['process:spawn']).toBe(false);
      expect(DEFAULT_UNTRUSTED_PERMISSIONS['network:raw']).toBe(false);
      expect(DEFAULT_UNTRUSTED_PERMISSIONS['filesystem:write']).toBe(false);
    });

    it('should have reasonable defaults for trusted plugins', () => {
      expect(DEFAULT_TRUSTED_PERMISSIONS['network:http']).toBe(true);
      expect(DEFAULT_TRUSTED_PERMISSIONS['environment:read']).toBe(true);
      expect(DEFAULT_TRUSTED_PERMISSIONS['process:spawn']).toBe(false);
    });
  });
});
