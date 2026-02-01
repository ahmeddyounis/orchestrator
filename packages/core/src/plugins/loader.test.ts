import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginLoader } from './loader';
import { Config, ConfigSchema } from '@orchestrator/shared';
import { Logger } from '@orchestrator/shared';
import * as fs from 'fs/promises';
import * as path from 'path';

vi.mock('fs/promises');

describe('PluginLoader', () => {
  let config: Config;
  let logger: Logger;
  let repoRoot: string;

  beforeEach(() => {
    config = {
      ...ConfigSchema.parse({}),
      plugins: {
        enabled: true,
        paths: ['.orchestrator/plugins'],
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
    repoRoot = '/test/repo';
  });

  it('should not load any plugins if disabled', async () => {
    config.plugins!.enabled = false;
    const loader = new PluginLoader(config, logger, repoRoot);
    const plugins = await loader.loadPlugins();
    expect(plugins).toHaveLength(0);
  });

  it('should discover and load a valid plugin', async () => {
    const pluginDir = path.join(repoRoot, '.orchestrator/plugins');
    const pluginFile = path.join(pluginDir, 'my-plugin.js');

    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: 'my-plugin.js', isFile: () => true, isDirectory: () => false },
    ] as any);

    vi.mocked(fs.readFile).mockResolvedValueOnce('plugin content');

    const mockPlugin = {
      manifest: {
        name: 'my-plugin',
        version: '1.0.0',
        type: 'provider',
      },
      createPlugin: () => ({
        name: 'my-plugin',
        sdkVersion: { minVersion: 1 },
        init: async () => {},
        healthCheck: async () => ({ ok: true }),
        generate: async () => ({ text: '' }),
      }),
    };

    vi.mock(pluginFile, () => ({
      default: mockPlugin,
      ...mockPlugin
    }));

    const loader = new PluginLoader(config, logger, repoRoot);
    const plugins = await loader.loadPlugins();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe('my-plugin');
    expect(logger.info).toHaveBeenCalledWith('Loaded plugin: my-plugin');
  });

  it('should skip plugin not in allowlist', async () => {
    config.plugins!.allowlistIds = ['another-plugin'];
    const pluginDir = path.join(repoRoot, '.orchestrator/plugins');
    const pluginFile = path.join(pluginDir, 'my-plugin.js');

    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: 'my-plugin.js', isFile: () => true, isDirectory: () => false },
    ] as any);

    vi.mocked(fs.readFile).mockResolvedValueOnce('plugin content');

    const mockPlugin = {
      manifest: {
        name: 'my-plugin',
        version: '1.0.0',
        type: 'provider',
      },
      createPlugin: () => ({}),
    };

    vi.mock(pluginFile, () => ({
      default: mockPlugin,
      ...mockPlugin
    }));

    const loader = new PluginLoader(config, logger, repoRoot);
    const plugins = await loader.loadPlugins();

    expect(plugins).toHaveLength(0);
    expect(logger.debug).toHaveBeenCalledWith('Skipping plugin my-plugin because it is not in the allowlist.');
  });
});
