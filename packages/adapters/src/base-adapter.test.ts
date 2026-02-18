import { describe, it, expect } from 'vitest';
import { BaseProviderAdapter, type APIErrorLike, type ErrorTypeConfig } from './base-adapter';
import { ConfigError, RateLimitError, TimeoutError } from './errors';

class TestAdapter extends BaseProviderAdapter {
  protected readonly errorConfig: ErrorTypeConfig = {
    isAPIError: (error: unknown): error is APIErrorLike => {
      if (!error || typeof error !== 'object') return false;
      const maybe = error as { status?: unknown; message?: unknown };
      return typeof maybe.status === 'number' && typeof maybe.message === 'string';
    },
    isTimeoutError: (error: unknown): boolean => error === 'timeout',
  };

  public map(error: unknown): Error {
    return this.mapError(error);
  }
}

describe('BaseProviderAdapter.mapError', () => {
  it('maps 429 to RateLimitError', () => {
    const adapter = new TestAdapter();
    const err = adapter.map({ status: 429, message: 'rate limited' });
    expect(err).toBeInstanceOf(RateLimitError);
  });

  it('maps 401 to ConfigError', () => {
    const adapter = new TestAdapter();
    const err = adapter.map({ status: 401, message: 'unauthorized' });
    expect(err).toBeInstanceOf(ConfigError);
  });

  it('passes through other API errors', () => {
    const adapter = new TestAdapter();
    const original = new Error('server');
    const err = adapter.map(Object.assign(original, { status: 500 }));
    expect(err).toBe(original);
  });

  it('maps timeout errors to TimeoutError', () => {
    const adapter = new TestAdapter();
    const err = adapter.map('timeout');
    expect(err).toBeInstanceOf(TimeoutError);
  });

  it('wraps non-Error values', () => {
    const adapter = new TestAdapter();
    const err = adapter.map(123);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('123');
  });
});

