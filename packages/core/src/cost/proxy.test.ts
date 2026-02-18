import { describe, it, expect, vi } from 'vitest';
import { CostTrackingAdapter } from './proxy';
import type { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import type { ModelRequest, StreamEvent } from '@orchestrator/shared';

const capabilities = () => ({
  supportsStreaming: true,
  supportsToolCalling: false,
  supportsJsonMode: true,
  modality: 'text' as const,
  latencyClass: 'fast' as const,
});

describe('CostTrackingAdapter', () => {
  it('records usage on generate when present', async () => {
    const tracker = { recordUsage: vi.fn() };
    const base: ProviderAdapter = {
      id: () => 'base',
      capabilities,
      generate: vi.fn().mockResolvedValue({
        text: 'hi',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      }),
    };

    const adapter = new CostTrackingAdapter('provider-1', base, tracker as any);
    const req = { messages: [{ role: 'user', content: 'hi' }] } as unknown as ModelRequest;
    const ctx = { runId: 'r1', logger: { log: vi.fn() } } as unknown as AdapterContext;

    const resp = await adapter.generate(req, ctx);
    expect(resp.text).toBe('hi');
    expect(tracker.recordUsage).toHaveBeenCalledWith('provider-1', {
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
    });
  });

  it('does not record usage on generate when usage is absent', async () => {
    const tracker = { recordUsage: vi.fn() };
    const base: ProviderAdapter = {
      id: () => 'base',
      capabilities,
      generate: vi.fn().mockResolvedValue({ text: 'hi' }),
    };

    const adapter = new CostTrackingAdapter('provider-1', base, tracker as any);
    const req = { messages: [{ role: 'user', content: 'hi' }] } as unknown as ModelRequest;
    const ctx = { runId: 'r1', logger: { log: vi.fn() } } as unknown as AdapterContext;

    await adapter.generate(req, ctx);
    expect(tracker.recordUsage).not.toHaveBeenCalled();
  });

  it('streams events and records usage events', async () => {
    const tracker = { recordUsage: vi.fn() };

    const stream = async function* (): AsyncIterable<StreamEvent> {
      yield { type: 'text-delta', content: 'a' };
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      yield { type: 'text-delta', content: 'b' };
    };

    const base: ProviderAdapter = {
      id: () => 'base',
      capabilities,
      generate: vi.fn().mockResolvedValue({ text: 'unused' }),
      stream: () => stream(),
    };

    const adapter = new CostTrackingAdapter('provider-1', base, tracker as any);
    const req = { messages: [{ role: 'user', content: 'hi' }] } as unknown as ModelRequest;
    const ctx = { runId: 'r1', logger: { log: vi.fn() } } as unknown as AdapterContext;

    const events: StreamEvent[] = [];
    for await (const e of adapter.stream(req, ctx)) {
      events.push(e);
    }

    expect(events.map((e) => e.type)).toEqual(['text-delta', 'usage', 'text-delta']);
    expect(tracker.recordUsage).toHaveBeenCalledWith('provider-1', {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    });
  });

  it('is a no-op stream when the base adapter does not support streaming', async () => {
    const tracker = { recordUsage: vi.fn() };
    const base: ProviderAdapter = {
      id: () => 'base',
      capabilities: () => ({ ...capabilities(), supportsStreaming: false }),
      generate: vi.fn().mockResolvedValue({ text: 'unused' }),
    };

    const adapter = new CostTrackingAdapter('provider-1', base, tracker as any);
    const req = { messages: [{ role: 'user', content: 'hi' }] } as unknown as ModelRequest;
    const ctx = { runId: 'r1', logger: { log: vi.fn() } } as unknown as AdapterContext;

    const events: StreamEvent[] = [];
    for await (const e of adapter.stream(req, ctx)) {
      events.push(e);
    }
    expect(events).toEqual([]);
  });
});
