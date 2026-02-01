/**
 * Plugin SDK Integration Tests
 *
 * Tests plugin loading, version checking, and lifecycle hooks.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  loadPlugin,
  safeLoadPlugin,
  SDK_VERSION,
  PluginVersionMismatchError,
  PluginValidationError,
  type ProviderAdapterPlugin,
  type PluginExport,
  type PluginManifest,
  type PluginConfig,
  type PluginContext,
  type HealthCheckResult,
  type ModelRequest,
  type ModelResponse,
  type ProviderCapabilities,
  type Logger,
} from '@orchestrator/plugin-sdk';

// Mock logger that matches the Logger interface
const mockLogger: Logger = {
  log: vi.fn().mockResolvedValue(undefined),
};

const mockCtx: PluginContext = {
  runId: 'test-run-123',
  logger: mockLogger,
};

// Simple test plugin implementation
class TestProviderPlugin implements ProviderAdapterPlugin {
  readonly name = 'test-provider';
  readonly sdkVersion = { minVersion: 1, maxVersion: 1 };

  private initialized = false;
  private configValue?: string;

  async init(config: PluginConfig, _ctx: PluginContext): Promise<void> {
    this.configValue = config.testValue as string;
    this.initialized = true;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: this.initialized };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: false,
      supportsToolCalling: false,
      supportsJsonMode: false,
      modality: 'text',
      latencyClass: 'fast',
    };
  }

  async generate(_req: ModelRequest, _ctx: PluginContext): Promise<ModelResponse> {
    return {
      text: `response with config: ${this.configValue}`,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    };
  }

  getConfigValue(): string | undefined {
    return this.configValue;
  }
}

const validManifest: PluginManifest = {
  name: 'test-provider',
  description: 'Test plugin',
  type: 'provider',
  sdkVersion: { minVersion: 1, maxVersion: 1 },
  version: '1.0.0',
};

const validPluginExport: PluginExport<TestProviderPlugin> = {
  manifest: validManifest,
  createPlugin: () => new TestProviderPlugin(),
};

describe('Plugin SDK Integration', () => {
  describe('loadPlugin', () => {
    it('loads valid plugin successfully', async () => {
      const plugin = await loadPlugin(validPluginExport, { testValue: 'hello' }, mockCtx);

      expect(plugin.name).toBe('test-provider');
      expect(plugin.getConfigValue()).toBe('hello');

      const health = await plugin.healthCheck();
      expect(health.healthy).toBe(true);
    });

    it('initializes plugin with provided context', async () => {
      const plugin = await loadPlugin(validPluginExport, {}, mockCtx);

      const response = await plugin.generate(
        { messages: [{ role: 'user', content: 'test' }] },
        mockCtx,
      );

      expect(response.text).toContain('response');
    });

    it('rejects plugin with incompatible SDK version (too high)', async () => {
      const incompatibleExport: PluginExport<TestProviderPlugin> = {
        manifest: {
          ...validManifest,
          sdkVersion: { minVersion: 99 },
        },
        createPlugin: () => new TestProviderPlugin(),
      };

      await expect(loadPlugin(incompatibleExport, {}, mockCtx)).rejects.toThrow(
        PluginVersionMismatchError,
      );
    });

    it('rejects plugin with incompatible SDK version (too low)', async () => {
      const incompatibleExport: PluginExport<TestProviderPlugin> = {
        manifest: {
          ...validManifest,
          sdkVersion: { minVersion: 0, maxVersion: 0 },
        },
        createPlugin: () => new TestProviderPlugin(),
      };

      await expect(loadPlugin(incompatibleExport, {}, mockCtx)).rejects.toThrow(
        PluginVersionMismatchError,
      );
    });

    it('rejects plugin with invalid manifest', async () => {
      const invalidExport = {
        manifest: {
          name: 'invalid',
          // Missing required fields
        },
        createPlugin: () => new TestProviderPlugin(),
      };

      await expect(
        loadPlugin(invalidExport as PluginExport<TestProviderPlugin>, {}, mockCtx),
      ).rejects.toThrow(PluginValidationError);
    });

    it('rejects plugin with invalid type', async () => {
      const invalidExport = {
        manifest: {
          ...validManifest,
          type: 'invalid-type',
        },
        createPlugin: () => new TestProviderPlugin(),
      };

      await expect(
        loadPlugin(invalidExport as PluginExport<TestProviderPlugin>, {}, mockCtx),
      ).rejects.toThrow(PluginValidationError);
    });
  });

  describe('safeLoadPlugin', () => {
    it('returns success result for valid plugin', async () => {
      const result = await safeLoadPlugin(validPluginExport, {}, mockCtx);

      expect(result.success).toBe(true);
      expect(result.plugin).toBeDefined();
      expect(result.manifest?.name).toBe('test-provider');
      expect(result.error).toBeUndefined();
    });

    it('returns error result for invalid plugin', async () => {
      const invalidExport = {
        manifest: { name: 'bad' },
        createPlugin: () => new TestProviderPlugin(),
      };

      const result = await safeLoadPlugin(
        invalidExport as PluginExport<TestProviderPlugin>,
        {},
        mockCtx,
      );

      expect(result.success).toBe(false);
      expect(result.plugin).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  describe('SDK version', () => {
    it('SDK_VERSION is 1', () => {
      expect(SDK_VERSION).toBe(1);
    });
  });

  describe('plugin lifecycle', () => {
    it('shutdown cleans up plugin state', async () => {
      const plugin = await loadPlugin(validPluginExport, {}, mockCtx);

      let health = await plugin.healthCheck();
      expect(health.healthy).toBe(true);

      await plugin.shutdown();

      health = await plugin.healthCheck();
      expect(health.healthy).toBe(false);
    });
  });
});
