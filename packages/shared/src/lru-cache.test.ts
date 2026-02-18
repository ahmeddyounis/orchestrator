import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  it('throws for invalid maxSize', () => {
    expect(() => new LRUCache(0)).toThrow(/maxSize/i);
  });

  it('gets, sets, evicts oldest, and tracks size', () => {
    const cache = new LRUCache<string, number>(2);

    expect(cache.size).toBe(0);

    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(true);

    // Touch "a" so it becomes most-recently used.
    expect(cache.get('a')).toBe(1);

    // Adding "c" should evict "b" (the least-recently used).
    cache.set('c', 3);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
  });

  it('updates recency when setting an existing key', () => {
    const cache = new LRUCache<string, number>(2);

    cache.set('a', 1);
    cache.set('b', 2);

    cache.set('a', 10);
    expect(cache.get('a')).toBe(10);

    // "b" is now the oldest entry.
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('clears', () => {
    const cache = new LRUCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBeUndefined();
  });
});

