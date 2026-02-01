# Orchestrator Plugin SDK

The Plugin SDK provides stable interfaces for extending the orchestrator with custom providers, embedders, vector backends, and tool executors.

## Overview

Plugins allow you to:
- Add new LLM providers (OpenAI, Anthropic, custom models)
- Implement custom embedding providers
- Add vector storage backends (Qdrant, Pinecone, etc.)
- Create custom tool execution sandboxes

## Installation

```bash
npm install @orchestrator/plugin-sdk
```

## SDK Version

The SDK uses a simple integer versioning scheme. Plugins declare which SDK versions they're compatible with:

```typescript
import { SDK_VERSION } from '@orchestrator/plugin-sdk';

console.log(SDK_VERSION); // 1
```

Plugins specify a version range in their manifest:

```typescript
const manifest = {
  name: 'my-plugin',
  sdkVersion: { minVersion: 1, maxVersion: 1 },
  // ...
};
```

The orchestrator core validates version compatibility before loading plugins and emits helpful errors on mismatch.

## Creating a Provider Plugin

Provider plugins implement the `ProviderAdapterPlugin` interface to add LLM support.

### Step 1: Create the Plugin Class

```typescript
import type {
  ProviderAdapterPlugin,
  PluginConfig,
  PluginContext,
  HealthCheckResult,
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  SdkVersionRange,
} from '@orchestrator/plugin-sdk';

export class MyProviderPlugin implements ProviderAdapterPlugin {
  readonly name = 'my-provider';
  readonly sdkVersion: SdkVersionRange = { minVersion: 1 };

  private apiKey?: string;
  private initialized = false;

  async init(config: PluginConfig, ctx: PluginContext): Promise<void> {
    this.apiKey = config.apiKey as string;
    if (!this.apiKey) {
      throw new Error('API key required');
    }
    this.initialized = true;
    ctx.logger.log({ type: 'log', message: 'MyProvider initialized' });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.initialized) {
      return { healthy: false, message: 'Not initialized' };
    }
    // Optionally ping the API
    return { healthy: true, message: 'Connected' };
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonMode: false,
      modality: 'text',
      latencyClass: 'medium',
    };
  }

  async generate(req: ModelRequest, ctx: PluginContext): Promise<ModelResponse> {
    // Make API call to your provider
    const response = await fetch('https://api.myprovider.com/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: req.messages,
        max_tokens: req.maxTokens,
      }),
      signal: ctx.abortSignal,
    });

    const data = await response.json();

    return {
      text: data.content,
      usage: {
        inputTokens: data.usage.input,
        outputTokens: data.usage.output,
        totalTokens: data.usage.total,
      },
    };
  }

  // Optional: implement streaming
  async *stream(req: ModelRequest, ctx: PluginContext): AsyncIterable<StreamEvent> {
    // ... streaming implementation
  }
}
```

### Step 2: Create the Plugin Manifest

```typescript
import type { PluginManifest, PluginExport } from '@orchestrator/plugin-sdk';

export const manifest: PluginManifest = {
  name: 'my-provider',
  description: 'Custom LLM provider',
  type: 'provider',
  sdkVersion: { minVersion: 1, maxVersion: 1 },
  version: '1.0.0',
};

export function createPlugin(): MyProviderPlugin {
  return new MyProviderPlugin();
}

const pluginExport: PluginExport<MyProviderPlugin> = {
  manifest,
  createPlugin,
};

export default pluginExport;
```

### Step 3: Load the Plugin

```typescript
import { loadPlugin } from '@orchestrator/plugin-sdk';
import myPluginExport from './my-provider-plugin';

const plugin = await loadPlugin(myPluginExport, {
  apiKey: process.env.MY_API_KEY,
}, {
  runId: 'run-123',
  logger: myLogger,
});

// Use the plugin
const response = await plugin.generate({
  messages: [{ role: 'user', content: 'Hello!' }],
}, ctx);
```

## Creating an Embedder Plugin

Embedder plugins implement `EmbedderPlugin` to provide text embeddings:

```typescript
import type {
  EmbedderPlugin,
  PluginConfig,
  PluginContext,
  HealthCheckResult,
  SdkVersionRange,
} from '@orchestrator/plugin-sdk';

export class MyEmbedderPlugin implements EmbedderPlugin {
  readonly name = 'my-embedder';
  readonly sdkVersion: SdkVersionRange = { minVersion: 1 };

  private dimensions = 1536;

  async init(config: PluginConfig, ctx: PluginContext): Promise<void> {
    if (config.dimensions) {
      this.dimensions = config.dimensions as number;
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: true };
  }

  async shutdown(): Promise<void> {}

  dims(): number {
    return this.dimensions;
  }

  async embedTexts(texts: string[], ctx: PluginContext): Promise<number[][]> {
    // Call embedding API
    const response = await fetch('https://api.embeddings.com/embed', {
      method: 'POST',
      body: JSON.stringify({ texts }),
      signal: ctx.abortSignal,
    });
    const data = await response.json();
    return data.embeddings;
  }
}
```

## Creating a Vector Backend Plugin

Vector backend plugins implement `VectorMemoryBackendPlugin`:

```typescript
import type {
  VectorMemoryBackendPlugin,
  VectorItem,
  VectorQueryResult,
  VectorQueryFilter,
  VectorBackendInfo,
  PluginConfig,
  PluginContext,
  HealthCheckResult,
  SdkVersionRange,
} from '@orchestrator/plugin-sdk';

export class MyVectorBackendPlugin implements VectorMemoryBackendPlugin {
  readonly name = 'my-vector-backend';
  readonly sdkVersion: SdkVersionRange = { minVersion: 1 };

  async init(config: PluginConfig, ctx: PluginContext): Promise<void> {
    // Connect to vector database
  }

  async healthCheck(): Promise<HealthCheckResult> {
    // Ping the database
    return { healthy: true };
  }

  async shutdown(): Promise<void> {
    // Close connections
  }

  async upsert(repoId: string, items: VectorItem[], ctx: PluginContext): Promise<void> {
    // Insert/update vectors
  }

  async query(
    repoId: string,
    vector: Float32Array,
    topK: number,
    ctx: PluginContext,
    filter?: VectorQueryFilter,
  ): Promise<VectorQueryResult[]> {
    // Query similar vectors
    return [];
  }

  async deleteByIds(repoId: string, ids: string[], ctx: PluginContext): Promise<void> {
    // Delete vectors
  }

  async wipeRepo(repoId: string, ctx: PluginContext): Promise<void> {
    // Delete all vectors for repo
  }

  async info(): Promise<VectorBackendInfo> {
    return {
      backend: 'my-backend',
      dims: 1536,
      embedderId: 'openai',
      location: 'remote',
      supportsFilters: true,
    };
  }
}
```

## Creating a Tool Executor Plugin

Tool executor plugins implement `ToolExecutorPlugin`:

```typescript
import type {
  ToolExecutorPlugin,
  PluginConfig,
  PluginContext,
  HealthCheckResult,
  ToolRunRequest,
  ToolRunResult,
  ToolPolicy,
  SdkVersionRange,
} from '@orchestrator/plugin-sdk';

export class MyToolExecutorPlugin implements ToolExecutorPlugin {
  readonly name = 'my-executor';
  readonly sdkVersion: SdkVersionRange = { minVersion: 1 };

  async init(config: PluginConfig, ctx: PluginContext): Promise<void> {}

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: true };
  }

  async shutdown(): Promise<void> {}

  async execute(
    request: ToolRunRequest,
    policy: ToolPolicy,
    ctx: PluginContext,
  ): Promise<ToolRunResult> {
    // Execute command in sandbox
    return {
      exitCode: 0,
      durationMs: 100,
      stdoutPath: '/tmp/stdout.txt',
      stderrPath: '/tmp/stderr.txt',
      truncated: false,
    };
  }

  isAllowed(command: string, policy: ToolPolicy): boolean {
    // Pre-check if command is allowed
    return policy.enabled;
  }
}
```

## Error Handling

The SDK provides specific error classes:

```typescript
import {
  PluginValidationError,
  PluginVersionMismatchError,
} from '@orchestrator/plugin-sdk';

try {
  await loadPlugin(pluginExport, config, ctx);
} catch (error) {
  if (error instanceof PluginVersionMismatchError) {
    console.error(`Version mismatch: plugin requires ${error.requiredRange.minVersion}, SDK is ${error.currentVersion}`);
  } else if (error instanceof PluginValidationError) {
    console.error(`Invalid plugin: ${error.message}`);
  }
}
```

## Testing Plugins

Use the `safeLoadPlugin` helper for testing:

```typescript
import { safeLoadPlugin } from '@orchestrator/plugin-sdk';

const result = await safeLoadPlugin(pluginExport, config, ctx);

if (result.success) {
  console.log('Plugin loaded:', result.manifest?.name);
  // Use result.plugin
} else {
  console.error('Failed to load:', result.error);
}
```

## Best Practices

1. **Keep plugins minimal**: Avoid leaking internal types or dependencies
2. **Handle errors gracefully**: Implement proper error handling in all methods
3. **Support abort signals**: Check `ctx.abortSignal` for cancellation
4. **Implement health checks**: Make them lightweight and informative
5. **Clean up resources**: Always implement `shutdown()` properly
6. **Version carefully**: Use conservative version ranges to avoid breaking changes
