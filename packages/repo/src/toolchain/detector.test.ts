import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolchainDetector } from './detector';
import fs from 'node:fs/promises';

// Mock node:fs/promises
vi.mock('node:fs/promises');

describe('ToolchainDetector', () => {
  let detector: ToolchainDetector;
  const rootPath = '/app';

  beforeEach(() => {
    detector = new ToolchainDetector();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects pnpm + turbo with root scripts', async () => {
    // Setup mocks
    vi.mocked(fs.access).mockImplementation(async (p) => {
      const pStr = p.toString();
      if (pStr.endsWith('pnpm-workspace.yaml') || pStr.endsWith('turbo.json')) {
        return Promise.resolve();
      }
      return Promise.reject(new Error('ENOENT'));
    });

    vi.mocked(fs.readFile).mockImplementation(async (p) => {
      if (p.toString().endsWith('package.json')) {
        return JSON.stringify({
          scripts: {
            test: 'vitest',
            lint: 'eslint .',
            typecheck: 'tsc',
          },
        });
      }
      return Promise.reject(new Error('ENOENT'));
    });

    const profile = await detector.detect(rootPath);

    expect(profile.packageManager).toBe('pnpm');
    expect(profile.usesTurbo).toBe(true);
    expect(profile.scripts).toEqual({
      test: true,
      lint: true,
      typecheck: true,
    });
    expect(profile.commands).toEqual({
      testCmd: 'pnpm turbo run test',
      lintCmd: 'pnpm turbo run lint',
      typecheckCmd: 'pnpm turbo run typecheck',
    });
  });

  it('detects pnpm without turbo (standard scripts)', async () => {
    vi.mocked(fs.access).mockImplementation(async (p) => {
      const pStr = p.toString();
      if (pStr.endsWith('pnpm-workspace.yaml')) {
        return Promise.resolve();
      }
      return Promise.reject(new Error('ENOENT'));
    });

    vi.mocked(fs.readFile).mockImplementation(async (p) => {
      if (p.toString().endsWith('package.json')) {
        return JSON.stringify({
          scripts: {
            test: 'vitest',
            lint: 'eslint .',
            typecheck: 'tsc',
          },
        });
      }
      return Promise.reject(new Error('ENOENT'));
    });

    const profile = await detector.detect(rootPath);

    expect(profile.packageManager).toBe('pnpm');
    expect(profile.usesTurbo).toBe(false);
    expect(profile.commands).toEqual({
      testCmd: 'pnpm test',
      lintCmd: 'pnpm lint',
      typecheckCmd: 'pnpm typecheck',
    });
  });

  it('detects pnpm with missing root scripts (fallback to recursive)', async () => {
    vi.mocked(fs.access).mockImplementation(async (p) => {
      const pStr = p.toString();
      if (pStr.endsWith('pnpm-workspace.yaml')) {
        return Promise.resolve();
      }
      return Promise.reject(new Error('ENOENT'));
    });

    vi.mocked(fs.readFile).mockImplementation(async (p) => {
      if (p.toString().endsWith('package.json')) {
        return JSON.stringify({ scripts: {} }); // No scripts
      }
      return Promise.reject(new Error('ENOENT'));
    });

    const profile = await detector.detect(rootPath);

    expect(profile.packageManager).toBe('pnpm');
    expect(profile.commands).toEqual({
      testCmd: 'pnpm -r test',
      lintCmd: 'pnpm -r lint',
      typecheckCmd: 'pnpm -r typecheck',
    });
  });

  it('detects npm (non-pnpm fallback)', async () => {
    vi.mocked(fs.access).mockImplementation(async (p) => {
      const pStr = p.toString();
      if (pStr.endsWith('package-lock.json')) {
        return Promise.resolve();
      }
      return Promise.reject(new Error('ENOENT'));
    });

    vi.mocked(fs.readFile).mockImplementation(async (p) => {
      if (p.toString().endsWith('package.json')) {
        return JSON.stringify({
          scripts: {
            test: 'jest',
          },
        });
      }
      return Promise.reject(new Error('ENOENT'));
    });

    const profile = await detector.detect(rootPath);

    expect(profile.packageManager).toBe('npm');
    expect(profile.usesTurbo).toBe(false);
    // Based on implementation, we map what exists
    expect(profile.commands.testCmd).toBe('npm run test');
    expect(profile.commands.lintCmd).toBeUndefined();
  });
});
