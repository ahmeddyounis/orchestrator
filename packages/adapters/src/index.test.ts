import { describe, it, expect } from 'vitest';
import { ProviderAdapter, AdapterContext } from './index';
import { ModelRequest, ModelResponse, ProviderCapabilities, StreamEvent, Logger } from '@orchestrator/shared';

class MockAdapter implements ProviderAdapter {
  id(): string {
    return 'mock-adapter';
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsStreaming: true,
      supportsToolCalling: true,
      supportsJsonMode: true,
      modality: 'text',
      latencyClass: 'fast',
    };
  }

  async generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse> {
    return {
      text: 'Mock response',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    };
  }

  async *stream(req: ModelRequest, ctx: AdapterContext): AsyncIterable<StreamEvent> {
    yield { type: 'text-delta', content: 'Mock' };
    yield { type: 'text-delta', content: ' ' };
    yield { type: 'text-delta', content: 'response' };
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
  }
}

describe('ProviderAdapter Interface', () => {
  it('should be implementable', async () => {
    const adapter = new MockAdapter();
    expect(adapter.id()).toBe('mock-adapter');
    expect(adapter.capabilities().supportsStreaming).toBe(true);
    
    const mockLogger: Logger = { 
      log: async () => {} 
    };
    
    const ctx: AdapterContext = {
      runId: 'test-run',
      logger: mockLogger,
    };

    const response = await adapter.generate({ messages: [] }, ctx);
    expect(response.text).toBe('Mock response');

    const stream = adapter.stream!( { messages: [] }, ctx);
    const events: StreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events.length).toBe(4);
    expect(events[0]).toEqual({ type: 'text-delta', content: 'Mock' });
  });
});