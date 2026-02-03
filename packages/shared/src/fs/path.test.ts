import { join, normalizePath, relative, dirname, resolve, isWindows, isWSL } from './path';

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

  describe('relative', () => {
    it('should return relative path with forward slashes', () => {
      const from = '/home/user/project';
      const to = '/home/user/project/src/file.ts';
      expect(relative(from, to)).toBe('src/file.ts');
    });

    it('should handle parent directory traversal', () => {
      const from = '/home/user/project/src';
      const to = '/home/user/project/dist';
      expect(relative(from, to)).toBe('../dist');
    });
  });

  describe('dirname', () => {
    it('should return directory name with forward slashes', () => {
      expect(dirname('/home/user/file.ts')).toBe('/home/user');
    });
  });

  describe('resolve', () => {
    it('should resolve paths with forward slashes', () => {
      const result = resolve('/home', 'user', 'project');
      expect(result).toBe('/home/user/project');
      expect(result).not.toContain('\\');
    });
  });

  describe('isWindows', () => {
    it('should return a boolean', () => {
      expect(typeof isWindows()).toBe('boolean');
    });
  });
});
