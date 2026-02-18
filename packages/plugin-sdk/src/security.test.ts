import { describe, it, expect } from 'vitest';
import {
  verifyPluginSecurity,
  generateSigningKeyPair,
  signPluginContent,
  signPlugin,
  addTrustedKey,
  PluginSignatureError,
  PluginPermissionError,
  type PluginSecurityContext,
  type SecurePluginManifest,
} from './security';
import { DEFAULT_TRUSTED_PERMISSIONS, PLUGIN_SECURITY_VERSION } from '@orchestrator/shared';

function createBaseManifest(name: string): SecurePluginManifest {
  return {
    name,
    type: 'provider',
    sdkVersion: { minVersion: 1 },
    version: '1.0.0',
  };
}

describe('verifyPluginSecurity', () => {
  it('throws when signatures are required but the plugin is unsigned', () => {
    const ctx: PluginSecurityContext = {
      trustedKeys: new Map(),
      requireSignatures: true,
      enforcePermissions: false,
      grantedPermissions: {},
    };

    expect(() =>
      verifyPluginSecurity('unsigned', 'content', createBaseManifest('unsigned'), ctx),
    ).toThrow(PluginSignatureError);
  });

  it('throws when the signing key is not trusted', () => {
    const content = 'plugin content';
    const { publicKey, privateKey } = generateSigningKeyPair();
    const signature = signPluginContent(content, privateKey, publicKey);

    const ctx: PluginSecurityContext = {
      trustedKeys: new Map(),
      requireSignatures: true,
      enforcePermissions: false,
      grantedPermissions: {},
    };

    expect(() =>
      verifyPluginSecurity(
        'untrusted',
        content,
        { ...createBaseManifest('untrusted'), signature },
        ctx,
      ),
    ).toThrow(/Unknown signing key/);
  });

  it('passes with a valid signature and satisfied permissions', () => {
    const content = 'plugin content';
    const { publicKey, privateKey } = generateSigningKeyPair();
    const signature = signPluginContent(content, privateKey, publicKey);

    const ctx: PluginSecurityContext = {
      trustedKeys: new Map([[signature.keyFingerprint, publicKey]]),
      requireSignatures: true,
      enforcePermissions: true,
      grantedPermissions: DEFAULT_TRUSTED_PERMISSIONS,
    };

    const manifest: SecurePluginManifest = {
      ...createBaseManifest('secure'),
      signature,
      permissions: {
        schemaVersion: PLUGIN_SECURITY_VERSION,
        required: { 'network:http': true },
      },
    };

    expect(() => verifyPluginSecurity('secure', content, manifest, ctx)).not.toThrow();
  });

  it('throws when required permissions are missing', () => {
    const ctx: PluginSecurityContext = {
      trustedKeys: new Map(),
      requireSignatures: false,
      enforcePermissions: true,
      grantedPermissions: {},
    };

    const manifest: SecurePluginManifest = {
      ...createBaseManifest('needs-perms'),
      permissions: {
        schemaVersion: PLUGIN_SECURITY_VERSION,
        required: { 'network:http': true },
      },
    };

    expect(() => verifyPluginSecurity('needs-perms', 'content', manifest, ctx)).toThrow(
      PluginPermissionError,
    );
  });
});

describe('signPlugin', () => {
  it('returns a bundle whose manifest includes the signature', () => {
    const content = 'hello';
    const { publicKey, privateKey } = generateSigningKeyPair();
    const base = createBaseManifest('signed');

    const bundle = signPlugin(base, content, privateKey, publicKey);
    expect(bundle.content).toBe(content);
    expect(bundle.signature).toEqual(bundle.manifest.signature);
  });
});

describe('addTrustedKey', () => {
  it('adds the key to the context', () => {
    const ctx: PluginSecurityContext = {
      trustedKeys: new Map(),
      requireSignatures: true,
      enforcePermissions: true,
      grantedPermissions: DEFAULT_TRUSTED_PERMISSIONS,
    };

    addTrustedKey(ctx, 'fingerprint', 'public-key');
    expect(ctx.trustedKeys.get('fingerprint')).toBe('public-key');
  });
});
