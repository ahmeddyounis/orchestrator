/**
 * Plugin Loader Utilities
 *
 * Helpers for loading and validating plugins at runtime.
 */

import { PluginValidationError } from '@orchestrator/shared';
import {
  SDK_VERSION,
  isVersionCompatible,
  getVersionMismatchError,
  type SdkVersionRange,
} from './version';
import type {
  PluginExport,
  PluginLifecycle,
  PluginManifest,
  PluginContext,
  PluginConfig,
} from './interfaces';

/**
 * Result of loading a plugin
 */
export interface LoadPluginResult<T extends PluginLifecycle = PluginLifecycle> {
  success: boolean;
  plugin?: T;
  manifest?: PluginManifest;
  error?: string;
}

// Re-export error class for backward compatibility
export { PluginValidationError } from '@orchestrator/shared';

/**
 * Plugin version mismatch error
 */
export class PluginVersionMismatchError extends Error {
  constructor(
    public readonly pluginName: string,
    public readonly requiredRange: SdkVersionRange,
    public readonly currentVersion: number,
  ) {
    super(getVersionMismatchError(pluginName, requiredRange));
    this.name = 'PluginVersionMismatchError';
  }
}

/**
 * Validate a plugin manifest
 */
export function validateManifest(manifest: unknown): manifest is PluginManifest {
  if (!manifest || typeof manifest !== 'object') {
    return false;
  }
  const m = manifest as Record<string, unknown>;
  return (
    typeof m.name === 'string' &&
    typeof m.type === 'string' &&
    ['provider', 'embedder', 'vector-backend', 'tool-executor'].includes(m.type as string) &&
    typeof m.sdkVersion === 'object' &&
    m.sdkVersion !== null &&
    typeof (m.sdkVersion as SdkVersionRange).minVersion === 'number' &&
    typeof m.version === 'string'
  );
}

/**
 * Validate and load a plugin from an export object.
 * Throws PluginValidationError or PluginVersionMismatchError on failure.
 */
export async function loadPlugin<T extends PluginLifecycle>(
  pluginExport: PluginExport<T>,
  config: PluginConfig,
  ctx: PluginContext,
): Promise<T> {
  // Extract name for error reporting (before validation)
  const rawManifest = pluginExport.manifest as unknown as Record<string, unknown> | undefined;
  const pluginName = typeof rawManifest?.name === 'string' ? rawManifest.name : 'unknown';

  // Validate manifest
  if (!validateManifest(pluginExport.manifest)) {
    throw new PluginValidationError(pluginName, 'Invalid plugin manifest');
  }

  const { manifest, createPlugin } = pluginExport;

  // Check version compatibility
  if (!isVersionCompatible(manifest.sdkVersion)) {
    throw new PluginVersionMismatchError(manifest.name, manifest.sdkVersion, SDK_VERSION);
  }

  // Create plugin instance
  const plugin = createPlugin();

  // Initialize plugin
  await plugin.init(config, ctx);

  return plugin;
}

/**
 * Safely load a plugin, returning a result object instead of throwing
 */
export async function safeLoadPlugin<T extends PluginLifecycle>(
  pluginExport: PluginExport<T>,
  config: PluginConfig,
  ctx: PluginContext,
): Promise<LoadPluginResult<T>> {
  try {
    const plugin = await loadPlugin(pluginExport, config, ctx);
    return {
      success: true,
      plugin,
      manifest: pluginExport.manifest,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
