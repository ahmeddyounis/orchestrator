import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeAdapter } from './adapter';
import type { AdapterContext } from '../types';

describe('FakeAdapter', () => {
  const ctx: AdapterContext = {
    runId: 'test-run',
    logger: { log: vi.fn().mockResolvedValue(undefined) } as unknown as AdapterContext['logger'],
    retryOptions: { maxRetries: 0 },
  };

  const originalBehavior = process.env.FAKE_ADAPTER_BEHAVIOR;

  beforeEach(() => {
    delete process.env.FAKE_ADAPTER_BEHAVIOR;
  });

  afterEach(() => {
    if (originalBehavior === undefined) {
      delete process.env.FAKE_ADAPTER_BEHAVIOR;
    } else {
      process.env.FAKE_ADAPTER_BEHAVIOR = originalBehavior;
    }
  });

  it('returns a JSON plan when jsonMode is enabled', async () => {
    const adapter = new FakeAdapter({ type: 'fake', model: 'fake' });

    const res = await adapter.generate(
      {
        jsonMode: true,
        messages: [{ role: 'user', content: 'hello world' }],
      },
      ctx,
    );

    const parsed = JSON.parse(res.text);
    expect(parsed.steps[0]).toContain('hello world');
  });

  it('returns a generic JSON plan when jsonMode is enabled and prompt is not special', async () => {
    const adapter = new FakeAdapter({ type: 'fake', model: 'fake' });

    const res = await adapter.generate(
      {
        jsonMode: true,
        messages: [{ role: 'user', content: 'do a thing' }],
      },
      ctx,
    );

    expect(JSON.parse(res.text)).toEqual({ steps: ['Implement the requested change.'] });
  });

  it('returns a diff when jsonMode is disabled', async () => {
    const adapter = new FakeAdapter({ type: 'fake', model: 'fake' });

    const res = await adapter.generate(
      {
        messages: [{ role: 'user', content: 'hello world' }],
      },
      ctx,
    );

    expect(res.text).toContain('BEGIN_DIFF');
    expect(res.text).toContain('helloWorld');
  });

  it('cycles behavior when FAKE_ADAPTER_BEHAVIOR is set', async () => {
    process.env.FAKE_ADAPTER_BEHAVIOR = 'FAIL,SUCCESS';
    const adapter = new FakeAdapter({ type: 'fake', model: 'fake' });

    const fail = await adapter.generate({ messages: [{ role: 'user', content: 'x' }] }, ctx);
    expect(fail.text).toContain('BEGIN_DIFF');
    expect(fail.text).toContain('toBe(5)');
    expect(process.env.FAKE_ADAPTER_BEHAVIOR).toBe('SUCCESS');

    const ok = await adapter.generate({ messages: [{ role: 'user', content: 'x' }] }, ctx);
    expect(ok.text).toContain('toBe(3)');
  });
});
