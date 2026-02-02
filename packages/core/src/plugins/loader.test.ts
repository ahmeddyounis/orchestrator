import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PluginLoader } from './loader';
import { Config, ConfigSchema, Logger } from '@orchestrator/shared';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

describe('PluginLoader', () => {
  let config: Config;
  let logger: Logger;
  let repoRoot: string;
  let pluginsDir: string;

  beforeEach(async () => {
    pluginsDir = await fs.mkdtemp(path.join(tmpdir(), 'orchestrator-plugin-loader-'));
    config = {
      ...ConfigSchema.parse({}),
      plugins: {
        enabled: true,
        paths: [pluginsDir],
        allowlistIds: undefined,
      },
    };
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: () => logger,
    } as unknown as Logger;
    repoRoot = pluginsDir;
  });

  afterEach(async () => {
    await fs.rm(pluginsDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should not load any plugins if disabled', async () => {
    config.plugins!.enabled = false;
    const loader = new PluginLoader(config, logger, repoRoot);
    const plugins = await loader.loadPlugins();
    expect(plugins).toHaveLength(0);
  });

  it('should discover and load a valid plugin', async () => {
    const pluginFile = path.join(pluginsDir, 'my-plugin.mjs');
    await fs.writeFile(
      pluginFile,
      [
        "export const manifest = { name: 'my-plugin', type: 'provider', sdkVersion: { minVersion: 1, maxVersion: 1 }, version: '1.0.0' };",
        'export function createPlugin() {',
        '  return {',
        '    init: async () => {},',
        '    shutdown: async () => {},',
        "    healthCheck: async () => ({ healthy: true, message: 'ok' }),",
        "    capabilities: () => ({ supportsStreaming: false, supportsToolCalling: false, supportsJsonMode: false, modality: 'text', latencyClass: 'fast' }),",
        "    generate: async () => ({ text: '' }),",
        '  };',
        '}',
        'export default { manifest, createPlugin };',
        '',
      ].join('\n'),
      'utf8',
    );

    const loader = new PluginLoader(config, logger, repoRoot);
    const plugins = await loader.loadPlugins();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe('my-plugin');
    expect(logger.info).toHaveBeenCalledWith('Loaded plugin: my-plugin');
  });

  it('should skip plugin not in allowlist', async () => {
    config.plugins!.allowlistIds = ['another-plugin'];
    const pluginFile = path.join(pluginsDir, 'my-plugin.mjs');
    await fs.writeFile(
      pluginFile,
      [
        "export const manifest = { name: 'my-plugin', type: 'provider', sdkVersion: { minVersion: 1, maxVersion: 1 }, version: '1.0.0' };",
        'export function createPlugin() { return { init: async () => {} }; }',
        'export default { manifest, createPlugin };',
        '',
      ].join('\n'),
      'utf8',
    );

    const loader = new PluginLoader(config, logger, repoRoot);
    const plugins = await loader.loadPlugins();

    expect(plugins).toHaveLength(0);
    expect(logger.debug).toHaveBeenCalledWith(
      'Skipping plugin my-plugin because it is not in the allowlist.',
    );
  });
});
