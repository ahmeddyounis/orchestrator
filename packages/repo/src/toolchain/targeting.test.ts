import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TargetingManager } from './targeting';
import { ToolchainProfile } from './types';
import fs from 'node:fs/promises';
import path from 'path';

vi.mock('node:fs/promises');

describe('TargetingManager', () => {
  let targeting: TargetingManager;
  const rootPath = '/app';

  beforeEach(() => {
    targeting = new TargetingManager();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('resolveTouchedPackages', () => {
    it('resolves packages for files inside packages', async () => {
      // Mock fs.readFile
      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        const pStr = p.toString();
        if (pStr === path.resolve(rootPath, 'packages/a/package.json')) {
          return JSON.stringify({ name: 'pkg-a' });
        }
        if (pStr === path.resolve(rootPath, 'packages/b/sub/package.json')) {
          // Nested package? or just regular
          return JSON.stringify({ name: 'pkg-b' });
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const touchedFiles = [
        'packages/a/src/index.ts',
        'packages/b/sub/lib/utils.ts',
        'README.md', // root file, should be ignored or not match package
      ];

      const packages = await targeting.resolveTouchedPackages(rootPath, touchedFiles);

      expect(packages.has('pkg-a')).toBe(true);
      expect(packages.has('pkg-b')).toBe(true);
      expect(packages.size).toBe(2);
    });

    it('ignores files outside of packages', async () => {
      vi.mocked(fs.readFile).mockImplementation(async () => Promise.reject(new Error('ENOENT')));

      const touchedFiles = ['docs/readme.md', 'unknown/file.ts'];
      const packages = await targeting.resolveTouchedPackages(rootPath, touchedFiles);
      expect(packages.size).toBe(0);
    });
    
    it('handles files that map to the same package', async () => {
      vi.mocked(fs.readFile).mockImplementation(async (p) => {
        const pStr = p.toString();
        if (pStr === path.resolve(rootPath, 'packages/a/package.json')) {
          return JSON.stringify({ name: 'pkg-a' });
        }
        return Promise.reject(new Error('ENOENT'));
      });

      const touchedFiles = ['packages/a/src/foo.ts', 'packages/a/src/bar.ts'];
      const packages = await targeting.resolveTouchedPackages(rootPath, touchedFiles);
      
      expect(packages.size).toBe(1);
      expect(packages.has('pkg-a')).toBe(true);
    });
  });

  describe('generateTargetedCommand', () => {
    const baseProfile: ToolchainProfile = {
      packageManager: 'pnpm',
      usesTurbo: false,
      scripts: { test: true, lint: true, typecheck: true },
      commands: {},
    };

    it('generates pnpm -r filter command', () => {
      const packages = new Set(['pkg-a', 'pkg-b']);
      const cmd = targeting.generateTargetedCommand(baseProfile, packages, 'test');
      
      expect(cmd).toContain('pnpm -r');
      expect(cmd).toContain('--filter pkg-a');
      expect(cmd).toContain('--filter pkg-b');
      expect(cmd).toContain('test');
    });

    it('generates turbo filter command', () => {
      const profile = { ...baseProfile, usesTurbo: true };
      const packages = new Set(['pkg-a']);
      const cmd = targeting.generateTargetedCommand(profile, packages, 'lint');
      
      expect(cmd).toBe('pnpm turbo run lint --filter=pkg-a');
    });

    it('returns null if script is missing', () => {
       const profile = { ...baseProfile, scripts: { ...baseProfile.scripts, test: false } };
       const packages = new Set(['pkg-a']);
       const cmd = targeting.generateTargetedCommand(profile, packages, 'test');
       expect(cmd).toBeNull();
    });

    it('returns null if no packages', () => {
        const packages = new Set<string>();
        const cmd = targeting.generateTargetedCommand(baseProfile, packages, 'test');
        expect(cmd).toBeNull();
    });
    
    it('returns null for non-pnpm (unsupported)', () => {
        const profile = { ...baseProfile, packageManager: 'npm' as const };
        const packages = new Set(['pkg-a']);
        const cmd = targeting.generateTargetedCommand(profile, packages, 'test');
        expect(cmd).toBeNull();
    });
  });
});
