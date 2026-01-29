import { describe, it, expect } from 'vitest';
import { redact } from './redactor';

describe('redactor', () => {
  it('passes through strings', () => {
    expect(redact('hello')).toBe('hello');
  });

  it('passes through numbers', () => {
    expect(redact(123)).toBe(123);
  });

  it('recursively processes arrays', () => {
    expect(redact(['a', 1])).toEqual(['a', 1]);
  });

  it('recursively processes objects', () => {
    expect(redact({ a: 'b', c: 1 })).toEqual({ a: 'b', c: 1 });
  });

  it('handles nested structures', () => {
    const input = {
      list: [{ name: 'test' }, 'string'],
      meta: { id: 1 },
    };
    expect(redact(input)).toEqual(input);
  });
});
