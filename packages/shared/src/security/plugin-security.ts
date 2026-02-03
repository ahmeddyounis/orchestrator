/**
 * Plugin Security Module
 *
 * Provides signing and verification for plugins to ensure integrity
 * and authenticity of custom adapters.
 */

import { createHash, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { z } from 'zod';

/**
 * Algorithm used for plugin signatures
 */
export const SIGNATURE_ALGORITHM = 'RSA-SHA256';

/**
 * Current plugin security schema version
 */
export const PLUGIN_SECURITY_VERSION = 1;

/**
 * Permission categories for plugins
 */
export type PluginPermissionCategory =
  | 'filesystem'
  | 'network'
  | 'process'
  | 'environment'
  | 'memory'
  | 'system';

/**
 * Specific permissions within each category
 */
export const PluginPermissionSchema = z.object({
  /** Read files from the filesystem */
  'filesystem:read': z.boolean().optional(),
  /** Write files to the filesystem */
  'filesystem:write': z.boolean().optional(),
  /** Execute filesystem operations like delete, rename */
  'filesystem:execute': z.boolean().optional(),

  /** Make outbound HTTP/HTTPS requests */
  'network:http': z.boolean().optional(),
  /** Open WebSocket connections */
  'network:websocket': z.boolean().optional(),
  /** Access arbitrary network sockets */
  'network:raw': z.boolean().optional(),

  /** Spawn child processes */
  'process:spawn': z.boolean().optional(),
  /** Execute shell commands */
  'process:shell': z.boolean().optional(),
  /** Send signals to processes */
  'process:signal': z.boolean().optional(),

  /** Read environment variables */
  'environment:read': z.boolean().optional(),
  /** Modify environment variables */
  'environment:write': z.boolean().optional(),

  /** Use shared memory / IPC */
  'memory:shared': z.boolean().optional(),
  /** Access vector memory backends */
  'memory:vector': z.boolean().optional(),

  /** Access system information */
  'system:info': z.boolean().optional(),
  /** Load native modules */
  'system:native': z.boolean().optional(),
});

export type PluginPermissions = z.infer<typeof PluginPermissionSchema>;

/**
 * Permission manifest declaring what a plugin needs access to
 */
export const PermissionManifestSchema = z.object({
  /** Schema version for forward compatibility */
  schemaVersion: z.number().default(PLUGIN_SECURITY_VERSION),

  /** Required permissions the plugin needs to function */
  required: PluginPermissionSchema,

  /** Optional permissions that enhance functionality but aren't required */
  optional: PluginPermissionSchema.optional(),

  /** Human-readable justification for each permission */
  justifications: z.record(z.string(), z.string()).optional(),

  /** Allowed network hosts (if network permissions are requested) */
  allowedHosts: z.array(z.string()).optional(),

  /** Allowed file paths/patterns (if filesystem permissions are requested) */
  allowedPaths: z.array(z.string()).optional(),
});

export type PermissionManifest = z.infer<typeof PermissionManifestSchema>;

/**
 * Plugin signature containing cryptographic proof of authenticity
 */
export const PluginSignatureSchema = z.object({
  /** Schema version */
  schemaVersion: z.number(),

  /** Signature algorithm used */
  algorithm: z.string(),

  /** Base64-encoded signature of the plugin content hash */
  signature: z.string(),

  /** SHA-256 hash of the signed content */
  contentHash: z.string(),

  /** Timestamp when the signature was created */
  signedAt: z.string().datetime(),

  /** Public key fingerprint (SHA-256 of the public key) */
  keyFingerprint: z.string(),

  /** Optional: Certificate chain for PKI-based verification */
  certificateChain: z.array(z.string()).optional(),
});

export type PluginSignature = z.infer<typeof PluginSignatureSchema>;

/**
 * Result of signature verification
 */
export interface VerificationResult {
  valid: boolean;
  reason?: string;
  keyFingerprint?: string;
  signedAt?: Date;
}

/**
 * Generate a key pair for plugin signing
 */
export function generateSigningKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });
  return { publicKey, privateKey };
}

/**
 * Calculate the fingerprint of a public key
 */
export function getKeyFingerprint(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex');
}

/**
 * Calculate the content hash of plugin data
 */
export function calculateContentHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Sign plugin content with a private key
 */
export function signPluginContent(
  content: string | Buffer,
  privateKey: string,
  publicKey: string,
): PluginSignature {
  const contentHash = calculateContentHash(content);
  const keyFingerprint = getKeyFingerprint(publicKey);

  const sign = createSign(SIGNATURE_ALGORITHM);
  sign.update(contentHash);
  const signature = sign.sign(privateKey, 'base64');

  return {
    schemaVersion: PLUGIN_SECURITY_VERSION,
    algorithm: SIGNATURE_ALGORITHM,
    signature,
    contentHash,
    signedAt: new Date().toISOString(),
    keyFingerprint,
  };
}

/**
 * Verify a plugin signature
 */
export function verifyPluginSignature(
  content: string | Buffer,
  signature: PluginSignature,
  trustedKeys: Map<string, string>,
): VerificationResult {
  // Validate signature schema
  const parseResult = PluginSignatureSchema.safeParse(signature);
  if (!parseResult.success) {
    return { valid: false, reason: 'Invalid signature schema' };
  }

  // Check if we have the public key
  const publicKey = trustedKeys.get(signature.keyFingerprint);
  if (!publicKey) {
    return {
      valid: false,
      reason: `Unknown signing key: ${signature.keyFingerprint}`,
    };
  }

  // Verify the content hash matches
  const actualHash = calculateContentHash(content);
  if (actualHash !== signature.contentHash) {
    return {
      valid: false,
      reason: 'Content hash mismatch - plugin may have been modified',
    };
  }

  // Verify the cryptographic signature
  try {
    const verify = createVerify(signature.algorithm);
    verify.update(signature.contentHash);
    const isValid = verify.verify(publicKey, signature.signature, 'base64');

    if (!isValid) {
      return { valid: false, reason: 'Cryptographic signature verification failed' };
    }

    return {
      valid: true,
      keyFingerprint: signature.keyFingerprint,
      signedAt: new Date(signature.signedAt),
    };
  } catch (error) {
    return {
      valid: false,
      reason: `Signature verification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Validate a permission manifest
 */
export function validatePermissionManifest(manifest: unknown): manifest is PermissionManifest {
  const result = PermissionManifestSchema.safeParse(manifest);
  return result.success;
}

/**
 * Check if granted permissions satisfy required permissions
 */
export function checkPermissions(
  required: PluginPermissions,
  granted: PluginPermissions,
): { satisfied: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const [key, value] of Object.entries(required)) {
    if (value === true && !granted[key as keyof PluginPermissions]) {
      missing.push(key);
    }
  }

  return {
    satisfied: missing.length === 0,
    missing,
  };
}

/**
 * Default permission set for untrusted plugins (very restrictive)
 */
export const DEFAULT_UNTRUSTED_PERMISSIONS: PluginPermissions = {
  'filesystem:read': false,
  'filesystem:write': false,
  'filesystem:execute': false,
  'network:http': false,
  'network:websocket': false,
  'network:raw': false,
  'process:spawn': false,
  'process:shell': false,
  'process:signal': false,
  'environment:read': false,
  'environment:write': false,
  'memory:shared': false,
  'memory:vector': false,
  'system:info': false,
  'system:native': false,
};

/**
 * Default permission set for trusted plugins (provider adapters)
 */
export const DEFAULT_TRUSTED_PERMISSIONS: PluginPermissions = {
  'filesystem:read': true,
  'filesystem:write': false,
  'filesystem:execute': false,
  'network:http': true,
  'network:websocket': true,
  'network:raw': false,
  'process:spawn': false,
  'process:shell': false,
  'process:signal': false,
  'environment:read': true,
  'environment:write': false,
  'memory:shared': false,
  'memory:vector': true,
  'system:info': true,
  'system:native': false,
};
