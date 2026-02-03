/**
 * Plugin Security Module
 *
 * High-level security utilities for plugin signing and verification.
 */

import {
  PluginSignatureError,
  PluginPermissionError,
  generateSigningKeyPair,
  signPluginContent,
  verifyPluginSignature,
  checkPermissions,
  DEFAULT_TRUSTED_PERMISSIONS,
  type PluginSignature,
  type PluginPermissions,
  type PermissionManifest,
  type VerificationResult,
} from '@orchestrator/shared';
import type { PluginManifest } from './interfaces';

export {
  generateSigningKeyPair,
  signPluginContent,
  verifyPluginSignature,
  checkPermissions,
  PluginSignatureError,
  PluginPermissionError,
};

export type { PluginSignature, VerificationResult };

/**
 * Security context for plugin operations
 */
export interface PluginSecurityContext {
  /** Map of trusted key fingerprints to public keys */
  trustedKeys: Map<string, string>;
  /** Whether to require signed plugins */
  requireSignatures: boolean;
  /** Whether to enforce permission manifests */
  enforcePermissions: boolean;
  /** Granted permissions for plugins */
  grantedPermissions: PluginPermissions;
}

/**
 * Default security context (strict mode)
 */
export const DEFAULT_SECURITY_CONTEXT: PluginSecurityContext = {
  trustedKeys: new Map(),
  requireSignatures: true,
  enforcePermissions: true,
  grantedPermissions: DEFAULT_TRUSTED_PERMISSIONS,
};

/**
 * Relaxed security context for development
 */
export const DEV_SECURITY_CONTEXT: PluginSecurityContext = {
  trustedKeys: new Map(),
  requireSignatures: false,
  enforcePermissions: false,
  grantedPermissions: {
    'filesystem:read': true,
    'filesystem:write': true,
    'filesystem:execute': true,
    'network:http': true,
    'network:websocket': true,
    'network:raw': true,
    'process:spawn': true,
    'process:shell': true,
    'process:signal': true,
    'environment:read': true,
    'environment:write': true,
    'memory:shared': true,
    'memory:vector': true,
    'system:info': true,
    'system:native': true,
  },
};

/**
 * Extended plugin manifest with security information
 */
export interface SecurePluginManifest extends PluginManifest {
  /** Permission manifest declaring required/optional permissions */
  permissions?: PermissionManifest;
  /** Cryptographic signature for the plugin */
  signature?: PluginSignature;
}

/**
 * Verify a plugin's security (signature and permissions)
 */
export function verifyPluginSecurity(
  pluginName: string,
  content: string | Buffer,
  manifest: SecurePluginManifest,
  ctx: PluginSecurityContext,
): void {
  // Verify signature if required
  if (ctx.requireSignatures) {
    if (!manifest.signature) {
      throw new PluginSignatureError(pluginName, 'Plugin is not signed');
    }

    const result = verifyPluginSignature(content, manifest.signature, ctx.trustedKeys);
    if (!result.valid) {
      throw new PluginSignatureError(pluginName, result.reason || 'Verification failed');
    }
  }

  // Check permissions if enforced
  if (ctx.enforcePermissions && manifest.permissions) {
    const { satisfied, missing } = checkPermissions(
      manifest.permissions.required,
      ctx.grantedPermissions,
    );

    if (!satisfied) {
      throw new PluginPermissionError(pluginName, missing);
    }
  }
}

/**
 * Create a signed plugin bundle
 */
export interface SignedPluginBundle {
  manifest: SecurePluginManifest;
  content: string;
  signature: PluginSignature;
}

/**
 * Sign a plugin for distribution
 */
export function signPlugin(
  manifest: PluginManifest,
  content: string,
  privateKey: string,
  publicKey: string,
): SignedPluginBundle {
  const signature = signPluginContent(content, privateKey, publicKey);

  return {
    manifest: {
      ...manifest,
      signature,
    },
    content,
    signature,
  };
}

/**
 * Add a trusted key to the security context
 */
export function addTrustedKey(
  ctx: PluginSecurityContext,
  fingerprint: string,
  publicKey: string,
): void {
  ctx.trustedKeys.set(fingerprint, publicKey);
}
