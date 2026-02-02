import { join, normalizePath } from './path';

describe('path', () => {
  describe('normalizePath', () => {
    it('should replace backslashes with forward slashes', () => {
      expect(normalizePath('foo\\bar')).toBe('foo/bar');
    });

    it('should not alter paths with forward slashes', () => {
      expect(normalizePath('foo/bar')).toBe('foo/bar');
    });
  });

  describe('join', () => {
    it('should join paths and normalize', () => {
      expect(join('foo', 'bar', '..', 'baz')).toBe('foo/baz');
    });
  });
});
