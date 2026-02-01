/**
 * Dummy Provider Plugin
 *
 * A simple plugin implementation for testing the plugin SDK.
 * Returns predictable responses for testing purposes.
 */

import type {
  ProviderAdapterPlugin,
  PluginManifest,
  PluginExport,
  PluginConfig,
  PluginContext,
  HealthCheckResult,
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  SdkVersionRange,
} from '@orchestrator/plugin-sdk';

export class DummyProviderPlugin implements ProviderAdapterPlugin {
  readonly name = 'dummy-provider';
  readonly sdkVersion: SdkVersionRange = { minVersion: 1, maxVersion: 1 };

  private initialized = false;
  private responsePrefix = 'dummy: ';

  async init(config: PluginConfig, _ctx: PluginContext): Promise<void> {
    if (config.responsePrefix && typeof config.responsePrefix === 'string') {
      this.responsePrefix = config.responsePrefix;
    }
    this.initialized = true;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      healthy: this.initialized,
      message: this.initialized ? 'Ready' : 'Not initialized',
    };
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

  async generate(req: ModelRequest, _ctx: PluginContext): Promise<ModelResponse> {
    if (!this.initialized) {
      throw new Error('Plugin not initialized');
    }

    // Extract last user message
    const lastUserMessage = [...req.messages].reverse().find((m) => m.role === 'user');
    const content = lastUserMessage?.content ?? '';

    return {
      text: `${this.responsePrefix}${content}`,
      usage: {
        inputTokens: content.length,
        outputTokens: this.responsePrefix.length + content.length,
        totalTokens: content.length * 2 + this.responsePrefix.length,
      },
    };
  }
}

/**
 * Plugin manifest
 */
export const manifest: PluginManifest = {
  name: 'dummy-provider',
  description: 'A dummy provider plugin for testing',
  type: 'provider',
  sdkVersion: { minVersion: 1, maxVersion: 1 },
  version: '1.0.0',
};

/**
 * Factory function to create the plugin
 */
export function createPlugin(): DummyProviderPlugin {
  return new DummyProviderPlugin();
}

/**
 * Default export for plugin loader
 */
const pluginExport: PluginExport<DummyProviderPlugin> = {
  manifest,
  createPlugin,
};

export default pluginExport;
