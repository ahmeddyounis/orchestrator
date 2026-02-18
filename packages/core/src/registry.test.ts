import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry, EventBus, RegistryError, validateProviderConfig } from './registry';
import { Config, ConfigSchema, ProviderCapabilities, ModelResponse } from '@orchestrator/shared';
import { ProviderAdapter } from '@orchestrator/adapters';
import { CostTrackingAdapter } from './cost/proxy';

class MockAdapter implements ProviderAdapter {
  constructor(
    private caps: ProviderCapabilities,
    private throwOnConstruct = false,
  ) {
    if (throwOnConstruct) {
      throw new Error('Construction failed');
    }
  }
  id() {
    return 'mock';
  }
  capabilities() {
    return this.caps;
  }
  async generate(): Promise<ModelResponse> {
    return {};
  }
}

const mockCapabilities: ProviderCapabilities = {
  supportsStreaming: false,
  supportsToolCalling: false,
  supportsJsonMode: false,
  modality: 'text',
  latencyClass: 'fast',
};

describe('ProviderRegistry', () => {
  const memory = ConfigSchema.parse({}).memory;

  it('registers and retrieves adapters', () => {
    const config: Config = {
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L1',
      providers: {
        'my-provider': { type: 'mock-type', model: 'gpt-4', api_key: 'secret' },
      },
    };
    const registry = new ProviderRegistry(config);

    registry.registerFactory('mock-type', () => new MockAdapter(mockCapabilities));

    const adapter = registry.getAdapter('my-provider');
    expect(adapter).toBeDefined();
    expect(adapter.capabilities()).toEqual(mockCapabilities);
  });

  it('throws for unknown provider', () => {
    const registry = new ProviderRegistry({
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L1',
      memory,
      providers: {},
    });
    expect(() => registry.getAdapter('non-existent')).toThrow("Provider 'non-existent' not found");
  });

  it('throws for unknown factory with exit code 2', () => {
    const config: Config = {
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L1',
      memory,
      providers: {
        'my-provider': { type: 'unknown-type', model: 'gpt-4' },
      },
    };
    const registry = new ProviderRegistry(config);

    try {
      registry.getAdapter('my-provider');
    } catch (e: unknown) {
      if (e instanceof RegistryError) {
        expect(e.message).toContain("Unknown provider type 'unknown-type'");
        expect(e.exitCode).toBe(2);
      } else {
        throw e;
      }
    }
  });

  it('throws for missing env var with exit code 2', () => {
    const config: Config = {
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L1',
      memory,
      providers: {
        'my-provider': { type: 'mock-type', model: 'gpt-4', api_key_env: 'MISSING_ENV_VAR' },
      },
    };
    const registry = new ProviderRegistry(config);
    registry.registerFactory('mock-type', () => new MockAdapter(mockCapabilities));

    try {
      registry.getAdapter('my-provider');
    } catch (e: unknown) {
      if (e instanceof RegistryError) {
        expect(e.message).toContain("Missing environment variable 'MISSING_ENV_VAR'");
        expect(e.exitCode).toBe(2);
      } else {
        throw e;
      }
    }
  });

  it('resolves role providers and emits events', async () => {
    const config: Config = {
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L1',
      memory,
      providers: {
        p1: { type: 'mock-type', model: 'm1' },
        p2: { type: 'mock-type', model: 'm1' },
        p3: { type: 'mock-type', model: 'm1' },
      },
    };
    const registry = new ProviderRegistry(config);
    registry.registerFactory('mock-type', () => new MockAdapter(mockCapabilities));

    const eventBus: EventBus = { emit: vi.fn() };
    const roles = { plannerId: 'p1', executorId: 'p2', reviewerId: 'p3' };

    const result = await registry.resolveRoleProviders(roles, { eventBus, runId: 'test-run' });

    expect(result.planner).toBeDefined();
    expect(result.executor).toBeDefined();
    expect(result.reviewer).toBeDefined();

    expect(eventBus.emit).toHaveBeenCalledTimes(3);
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ProviderSelected',
        payload: expect.objectContaining({ role: 'planner', providerId: 'p1' }),
      }),
    );
  });

  it('validateAllProviders returns empty results when providers are unset', () => {
    const registry = new ProviderRegistry({
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L1',
      memory,
    });

    expect(registry.validateAllProviders().size).toBe(0);
  });

  it('validateProvider uses a placeholder api_key when constructing adapters for capabilities', () => {
    const registry = new ProviderRegistry({
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L1',
      memory,
    });

    registry.registerFactory('mock-type', (cfg) => {
      expect(cfg.api_key).toBe('validation-placeholder');
      return new MockAdapter(mockCapabilities);
    });

    const result = registry.validateProvider('p1', { type: 'mock-type', model: 'm1' } as any);
    expect(result).toBeTruthy();
    expect(result?.valid).toBe(true);
  });

  it('resolves api_key from environment when api_key_env is set', () => {
    const envVar = 'ORCH_TEST_API_KEY';
    const prev = process.env[envVar];
    process.env[envVar] = 'from-env';

    try {
      const registry = new ProviderRegistry({
        verification: {} as any,
        configVersion: 1,
        thinkLevel: 'L1',
        memory,
        providers: {
          p1: { type: 'mock-type', model: 'm1', api_key_env: envVar },
        },
      });
      registry.registerFactory('mock-type', (cfg) => {
        expect(cfg.api_key).toBe('from-env');
        return new MockAdapter(mockCapabilities);
      });

      expect(registry.getAdapter('p1')).toBeDefined();
    } finally {
      if (prev === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = prev;
      }
    }
  });

  it('continues normal creation when validation throws a non-RegistryError', () => {
    const registry = new ProviderRegistry({
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L1',
      memory,
      providers: {
        p1: { type: 'mock-type', model: 'm1' },
      },
    });

    let calls = 0;
    registry.registerFactory('mock-type', () => {
      calls += 1;
      if (calls === 1) throw new Error('validation construction failed');
      return new MockAdapter(mockCapabilities);
    });

    expect(registry.getAdapter('p1')).toBeDefined();
  });

  it('logs warnings during config validation without blocking adapter creation', () => {
    const registry = new ProviderRegistry({
      verification: {} as any,
      configVersion: 1,
      thinkLevel: 'L1',
      memory,
      providers: {
        p1: { type: 'mock-type', model: 'm1', supportsTools: true },
      },
    });
    registry.registerFactory('mock-type', () => new MockAdapter(mockCapabilities));

    expect(registry.getAdapter('p1')).toBeDefined();
  });

  it('wraps adapters with cost tracking when a cost tracker is provided', () => {
    const registry = new ProviderRegistry(
      {
        verification: {} as any,
        configVersion: 1,
        thinkLevel: 'L1',
        memory,
        providers: {
          p1: { type: 'mock-type', model: 'm1', api_key: 'sk-test' },
        },
      } as Config,
      { recordUsage: vi.fn() } as any,
    );
    registry.registerFactory('mock-type', () => new MockAdapter(mockCapabilities));

    const adapter = registry.getAdapter('p1');
    expect(adapter).toBeInstanceOf(CostTrackingAdapter);
  });

  describe('config validation', () => {
    it('validates provider config against adapter capabilities', () => {
      const capsWithRequirements: ProviderCapabilities = {
        ...mockCapabilities,
        configRequirements: {
          requiresApiKey: true,
        },
      };

      const config: Config = {
        verification: {} as any,
        configVersion: 1,
        thinkLevel: 'L1',
        memory,
        providers: {
          'my-provider': { type: 'mock-type', model: 'gpt-4' }, // Missing API key
        },
      };
      const registry = new ProviderRegistry(config);
      registry.registerFactory('mock-type', () => new MockAdapter(capsWithRequirements));

      expect(() => registry.getAdapter('my-provider')).toThrow(RegistryError);
      expect(() => registry.getAdapter('my-provider')).toThrow(/requires an API key/);
    });

    it('passes validation when requirements are met', () => {
      const capsWithRequirements: ProviderCapabilities = {
        ...mockCapabilities,
        configRequirements: {
          requiresApiKey: true,
        },
      };

      const config: Config = {
        verification: {} as any,
        configVersion: 1,
        thinkLevel: 'L1',
        memory,
        providers: {
          'my-provider': { type: 'mock-type', model: 'gpt-4', api_key: 'sk-test' },
        },
      };
      const registry = new ProviderRegistry(config);
      registry.registerFactory('mock-type', () => new MockAdapter(capsWithRequirements));

      const adapter = registry.getAdapter('my-provider');
      expect(adapter).toBeDefined();
    });

    it('validates forbidden args in config', () => {
      const capsWithForbiddenArgs: ProviderCapabilities = {
        ...mockCapabilities,
        configRequirements: {
          forbiddenArgs: ['--json', '--model'],
        },
      };

      const config: Config = {
        verification: {} as any,
        configVersion: 1,
        thinkLevel: 'L1',
        memory,
        providers: {
          'my-provider': { type: 'mock-type', model: 'gpt-4', args: ['--json', '--verbose'] },
        },
      };
      const registry = new ProviderRegistry(config);
      registry.registerFactory('mock-type', () => new MockAdapter(capsWithForbiddenArgs));

      expect(() => registry.getAdapter('my-provider')).toThrow(RegistryError);
      expect(() => registry.getAdapter('my-provider')).toThrow(/--json.*internally/);
    });

    it('validateAllProviders returns results for all providers', () => {
      const config: Config = {
        verification: {} as any,
        configVersion: 1,
        thinkLevel: 'L1',
        memory,
        providers: {
          p1: { type: 'mock-type', model: 'gpt-4', api_key: 'sk-1' },
          p2: { type: 'mock-type', model: 'gpt-4', api_key: 'sk-2' },
          p3: { type: 'unknown-type', model: 'unknown' }, // No factory registered
        },
      };
      const registry = new ProviderRegistry(config);
      registry.registerFactory('mock-type', () => new MockAdapter(mockCapabilities));

      const results = registry.validateAllProviders();

      expect(results.size).toBe(2); // p3 is skipped (no factory)
      expect(results.get('p1')?.valid).toBe(true);
      expect(results.get('p2')?.valid).toBe(true);
    });
  });

  describe('validateProviderConfig function', () => {
    it('is exported and usable directly', () => {
      const config = { type: 'test', model: 'test-model' };
      const capabilities: ProviderCapabilities = {
        supportsStreaming: false,
        supportsToolCalling: false,
        supportsJsonMode: false,
        modality: 'text',
        latencyClass: 'fast',
      };

      const result = validateProviderConfig(config, capabilities, 'test-provider');

      expect(result).toBeDefined();
      expect(result.valid).toBe(true);
    });
  });
});
