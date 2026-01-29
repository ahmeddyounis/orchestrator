import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry, EventBus, RegistryError } from './registry';
import { Config, ProviderCapabilities, ModelResponse } from '@orchestrator/shared';
import { ProviderAdapter } from '@orchestrator/adapters';

class MockAdapter implements ProviderAdapter {
  constructor(private caps: ProviderCapabilities) {}
  id() { return 'mock'; }
  capabilities() { return this.caps; }
  async generate(): Promise<ModelResponse> { return {}; }
}

const mockCapabilities: ProviderCapabilities = {
  supportsStreaming: false,
  supportsToolCalling: false,
  supportsJsonMode: false,
  modality: 'text',
  latencyClass: 'fast'
};

describe('ProviderRegistry', () => {
  it('registers and retrieves adapters', () => {
    const config: Config = {
      configVersion: 1,
      providers: {
        'my-provider': { type: 'mock-type', model: 'gpt-4', api_key: 'secret' }
      }
    };
    const registry = new ProviderRegistry(config);
    
    registry.registerFactory('mock-type', () => new MockAdapter(mockCapabilities));
    
    const adapter = registry.getAdapter('my-provider');
    expect(adapter).toBeDefined();
    expect(adapter.capabilities()).toEqual(mockCapabilities);
  });

  it('throws for unknown provider', () => {
    const registry = new ProviderRegistry({ configVersion: 1, providers: {} });
    expect(() => registry.getAdapter('non-existent')).toThrow("Provider 'non-existent' not found");
  });

  it('throws for unknown factory with exit code 2', () => {
    const config: Config = {
      configVersion: 1,
      providers: {
        'my-provider': { type: 'unknown-type', model: 'gpt-4' }
      }
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
      configVersion: 1,
      providers: {
        'my-provider': { type: 'mock-type', model: 'gpt-4', api_key_env: 'MISSING_ENV_VAR' }
      }
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
      configVersion: 1,
      providers: {
        'p1': { type: 'mock-type', model: 'm1' },
        'p2': { type: 'mock-type', model: 'm1' },
        'p3': { type: 'mock-type', model: 'm1' }
      }
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
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ProviderSelected',
        payload: expect.objectContaining({ role: 'planner', providerId: 'p1' })
    }));
  });
});
