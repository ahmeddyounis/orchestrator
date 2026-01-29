import { describe, it, expect } from 'vitest';
import { parseBudget, DEFAULT_BUDGET } from './budget';

describe('parseBudget', () => {
  it('should parse valid budget string', () => {
    const input = 'cost=5,iter=6,tool=10,time=20m';
    const result = parseBudget(input);
    expect(result).toEqual({
      cost: 5,
      iter: 6,
      tool: 10,
      time: 20 * 60 * 1000,
    });
  });

  it('should handle whitespace', () => {
    const input = ' cost = 5 , iter = 6 ';
    const result = parseBudget(input);
    expect(result).toEqual({
      cost: 5,
      iter: 6,
    });
  });

  it('should parse different time units', () => {
    expect(parseBudget('time=100ms').time).toBe(100);
    expect(parseBudget('time=10s').time).toBe(10000);
    expect(parseBudget('time=1m').time).toBe(60000);
    expect(parseBudget('time=1h').time).toBe(3600000);
    expect(parseBudget('time=500').time).toBe(500); // Default ms
  });

  it('should throw on invalid keys', () => {
    expect(() => parseBudget('foo=5')).toThrow('Unknown budget key: foo');
  });

  it('should throw on invalid format', () => {
    expect(() => parseBudget('cost5')).toThrow('Invalid budget format');
  });

  it('should throw on invalid values', () => {
    expect(() => parseBudget('cost=abc')).toThrow('Invalid cost value');
    expect(() => parseBudget('iter=abc')).toThrow('Invalid iter value');
    expect(() => parseBudget('time=abc')).toThrow('Invalid duration format');
  });

  it('should have reasonable defaults', () => {
    expect(DEFAULT_BUDGET).toEqual({
      iter: 4,
      tool: 6,
      time: 10 * 60 * 1000,
    });
  });
});
