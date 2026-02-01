import { describe, it, expect, beforeEach } from 'vitest';
import { loadPlugin, PluginVersionMismatchError, type Logger } from '@orchestrator/plugin-sdk';
import pluginExport, { DummyProviderPlugin, manifest } from './index';

describe('DummyProviderPlugin', () => {
  let plugin: DummyProviderPlugin;
  const mockLogger: Logger = {
    log: async () => {},
  };
  const mockCtx = {
    runId: 'test-run',
    logger: mockLogger,
  };

  beforeEach(async () => {
    plugin = new DummyProviderPlugin();
    await plugin.init({}, mockCtx);
  });

  it('has correct name and sdk version', () => {
    expect(plugin.name).toBe('dummy-provider');
    expect(plugin.sdkVersion).toEqual({ minVersion: 1, maxVersion: 1 });
  });

  it('returns healthy after init', async () => {
    const health = await plugin.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.message).toBe('Ready');
  });

  it('returns unhealthy before init', async () => {
    const freshPlugin = new DummyProviderPlugin();
    const health = await freshPlugin.healthCheck();
    expect(health.healthy).toBe(false);
  });

  it('generates response echoing user message', async () => {
    const response = await plugin.generate(
      {
        messages: [
          { role: 'user', content: 'Hello world' },
        ],
      },
      mockCtx,
    );
    expect(response.text).toBe('dummy: Hello world');
    expect(response.usage).toBeDefined();
  });

  it('uses custom response prefix from config', async () => {
    const customPlugin = new DummyProviderPlugin();
    await customPlugin.init({ responsePrefix: 'echo: ' }, mockCtx);
    
    const response = await customPlugin.generate(
      {
        messages: [{ role: 'user', content: 'test' }],
      },
      mockCtx,
    );
    expect(response.text).toBe('echo: test');
  });

  it('throws when generate called before init', async () => {
    const uninitPlugin = new DummyProviderPlugin();
    await expect(
      uninitPlugin.generate({ messages: [] }, mockCtx),
    ).rejects.toThrow('Plugin not initialized');
  });

  it('reports capabilities', () => {
    const caps = plugin.capabilities();
    expect(caps.supportsStreaming).toBe(false);
    expect(caps.supportsToolCalling).toBe(false);
    expect(caps.modality).toBe('text');
    expect(caps.latencyClass).toBe('fast');
  });

  it('can be loaded via loadPlugin', async () => {
    const loadedPlugin = await loadPlugin(pluginExport, {}, mockCtx);
    expect(loadedPlugin.name).toBe('dummy-provider');
    
    const health = await loadedPlugin.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it('manifest has correct structure', () => {
    expect(manifest.name).toBe('dummy-provider');
    expect(manifest.type).toBe('provider');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.sdkVersion.minVersion).toBe(1);
  });
});

describe('version mismatch detection', () => {
  const mockCtx = {
    runId: 'test-run',
    logger: {
      log: async () => {},
    } as Logger,
  };

  it('rejects plugin with incompatible SDK version', async () => {
    const incompatibleExport = {
      manifest: {
        ...manifest,
        sdkVersion: { minVersion: 99 },
      },
      createPlugin: () => new DummyProviderPlugin(),
    };

    await expect(loadPlugin(incompatibleExport, {}, mockCtx)).rejects.toThrow(
      PluginVersionMismatchError,
    );
  });
});
