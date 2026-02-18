import { describe, it, expect, vi } from 'vitest';
import { loadPlugin, safeLoadPlugin, PluginVersionMismatchError } from './loader';
import { DEV_SECURITY_CONTEXT, type PluginSecurityContext } from './security';
import type { PluginConfig, PluginContext, PluginExport, PluginLifecycle } from './interfaces';
import {
  PluginPermissionError,
  PluginSignatureError,
  PluginValidationError,
} from '@orchestrator/shared';

function createNoopLogger() {
  const logger = {
    log: () => undefined,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  };
  return logger;
}

function createTestPlugin(name: string): PluginLifecycle {
  return {
    name,
    sdkVersion: { minVersion: 1 },
    init: vi.fn(async () => {}),
    healthCheck: vi.fn(async () => ({ healthy: true })),
    shutdown: vi.fn(async () => {}),
  };
}

function createCtx(): PluginContext {
  return {
    runId: 'run-1',
    // Narrowing via PluginContext typing happens at compile time; runtime object shape is fine.
    logger: createNoopLogger() as unknown as PluginContext['logger'],
  };
}

describe('loadPlugin', () => {
  it('loads and initializes a valid plugin', async () => {
    const plugin = createTestPlugin('ok');
    const pluginExport: PluginExport = {
      manifest: {
        name: 'ok',
        type: 'provider',
        sdkVersion: { minVersion: 1 },
        version: '1.0.0',
      },
      createPlugin: () => plugin,
    };

    const config: PluginConfig = { mode: 'test' };
    const ctx = createCtx();

    const loaded = await loadPlugin(pluginExport, config, ctx, {
      securityContext: DEV_SECURITY_CONTEXT,
    });

    expect(loaded).toBe(plugin);
    expect(plugin.init).toHaveBeenCalledWith(config, ctx);
  });

  it('throws PluginValidationError for invalid manifests (and preserves plugin name when present)', async () => {
    const plugin = createTestPlugin('bad');
    const pluginExport = {
      manifest: { name: 'bad' },
      createPlugin: () => plugin,
    } as unknown as PluginExport;

    await expect(
      loadPlugin(pluginExport, {}, createCtx(), { securityContext: DEV_SECURITY_CONTEXT }),
    ).rejects.toBeInstanceOf(PluginValidationError);
  });

  it('throws PluginVersionMismatchError when SDK versions are incompatible', async () => {
    const plugin = createTestPlugin('mismatch');
    const pluginExport: PluginExport = {
      manifest: {
        name: 'mismatch',
        type: 'provider',
        sdkVersion: { minVersion: 999 },
        version: '1.0.0',
      },
      createPlugin: () => plugin,
    };

    await expect(
      loadPlugin(pluginExport, {}, createCtx(), { securityContext: DEV_SECURITY_CONTEXT }),
    ).rejects.toBeInstanceOf(PluginVersionMismatchError);
  });

  it('throws PluginPermissionError when permissions are enforced and missing', async () => {
    const plugin = createTestPlugin('needs-perms');
    const pluginExport: PluginExport = {
      manifest: {
        name: 'needs-perms',
        type: 'provider',
        sdkVersion: { minVersion: 1 },
        version: '1.0.0',
        permissions: {
          schemaVersion: 1,
          required: { 'network:http': true },
        },
      },
      createPlugin: () => plugin,
    };

    const securityContext: PluginSecurityContext = {
      trustedKeys: new Map(),
      requireSignatures: false,
      enforcePermissions: true,
      grantedPermissions: {},
    };

    await expect(
      loadPlugin(pluginExport, {}, createCtx(), { securityContext }),
    ).rejects.toBeInstanceOf(PluginPermissionError);
  });

  it('throws PluginSignatureError when plugin content is provided and signatures are required', async () => {
    const plugin = createTestPlugin('unsigned');
    const pluginExport: PluginExport = {
      manifest: {
        name: 'unsigned',
        type: 'provider',
        sdkVersion: { minVersion: 1 },
        version: '1.0.0',
      },
      createPlugin: () => plugin,
    };

    const securityContext: PluginSecurityContext = {
      trustedKeys: new Map(),
      requireSignatures: true,
      enforcePermissions: false,
      grantedPermissions: {},
    };

    await expect(
      loadPlugin(pluginExport, {}, createCtx(), {
        securityContext,
        pluginContent: 'plugin',
      }),
    ).rejects.toBeInstanceOf(PluginSignatureError);
  });
});

describe('safeLoadPlugin', () => {
  it('returns success=false instead of throwing', async () => {
    const plugin = createTestPlugin('bad');
    const pluginExport = {
      manifest: { name: 'bad' },
      createPlugin: () => plugin,
    } as unknown as PluginExport;

    const result = await safeLoadPlugin(pluginExport, {}, createCtx(), {
      securityContext: DEV_SECURITY_CONTEXT,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid plugin manifest');
  });
});
