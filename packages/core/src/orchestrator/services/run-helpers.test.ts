import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  shouldAcceptEmptyDiffAsNoopForSatisfiedStep,
  shouldAllowEmptyDiffForStep,
  buildPatchApplyRetryContext,
  extractPatchErrorKind,
} from './run-helpers';
import type { PatchError } from '@orchestrator/shared';

const searchSpy = vi.fn();

vi.mock('@orchestrator/repo', () => ({
  SearchService: class {
    constructor(_rgPath?: string) {}
    search = searchSpy;
  },
}));

describe('run-helpers', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    vi.clearAllMocks();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  describe('shouldAcceptEmptyDiffAsNoopForSatisfiedStep', () => {
    it('returns allow=false for non-import steps', async () => {
      const result = await shouldAcceptEmptyDiffAsNoopForSatisfiedStep({
        step: 'Fix the bug',
        repoRoot: '/repo',
      });
      expect(result).toEqual({ allow: false });
    });

    it('returns allow=false for empty or undefined steps', async () => {
      expect(
        await shouldAcceptEmptyDiffAsNoopForSatisfiedStep({
          step: '',
          repoRoot: '/repo',
        }),
      ).toEqual({ allow: false });

      expect(
        await shouldAcceptEmptyDiffAsNoopForSatisfiedStep({
          step: undefined as any,
          repoRoot: '/repo',
        }),
      ).toEqual({ allow: false });
    });

    it('accepts a step satisfied in fused context (fast path)', async () => {
      const result = await shouldAcceptEmptyDiffAsNoopForSatisfiedStep({
        step: 'Use Foo\\\\Bar\\\\Baz in app/File.php',
        repoRoot: '/repo',
        contextText: 'app/File.php\nuse Foo\\Bar\\Baz;\n',
      });

      expect(searchSpy).not.toHaveBeenCalled();
      expect(result.allow).toBe(true);
      expect(result.reason).toContain('use Foo\\Bar\\Baz;');
    });

    it('accepts a step satisfied via repo search', async () => {
      searchSpy.mockResolvedValueOnce({
        matches: [
          {
            path: 'packages/app/app/File.php',
            line: 12,
            column: 1,
            matchText: 'Foo\\Bar\\Baz',
            lineText: 'use Foo\\Bar\\Baz as Alias;',
            score: 1,
          },
        ],
      });

      const result = await shouldAcceptEmptyDiffAsNoopForSatisfiedStep({
        step: 'Import Foo\\\\Bar\\\\Baz in app/File.php',
        repoRoot: '/repo',
      });

      expect(searchSpy).toHaveBeenCalled();
      expect(result.allow).toBe(true);
      expect(result.reason).toContain('Found existing PHP import in repo');
    });

    it('returns allow=false when repo matches are missing a usable lineText', async () => {
      searchSpy.mockResolvedValueOnce({
        matches: [
          {
            path: 'app/File.php',
            line: 12,
            column: 1,
            matchText: 'Foo\\Bar\\Baz',
            lineText: undefined,
            score: 1,
          },
        ],
      } as any);

      const result = await shouldAcceptEmptyDiffAsNoopForSatisfiedStep({
        step: 'Import Foo\\\\Bar\\\\Baz in app/File.php',
        repoRoot: '/repo',
      });

      expect(result).toEqual({ allow: false });
    });

    it('handles search errors as best-effort and returns allow=false', async () => {
      searchSpy.mockRejectedValueOnce(new Error('rg missing'));

      const result = await shouldAcceptEmptyDiffAsNoopForSatisfiedStep({
        step: 'Import Foo\\\\Bar\\\\Baz in app/File.php',
        repoRoot: '/repo',
      });

      expect(result).toEqual({ allow: false });
    });

    it('returns allow=false when the step is missing file or FQCN targets', async () => {
      expect(
        await shouldAcceptEmptyDiffAsNoopForSatisfiedStep({
          step: 'Import Foo\\\\Bar\\\\Baz',
          repoRoot: '/repo',
        }),
      ).toEqual({ allow: false });
    });

    it('returns allow=false when repo matches do not confirm a use-import line in the target file', async () => {
      searchSpy.mockResolvedValueOnce({
        matches: [
          {
            path: 'packages/app/app/Other.php',
            line: 12,
            column: 1,
            matchText: 'Foo\\Bar\\Baz',
            lineText: 'use Foo\\Bar\\Baz;',
            score: 1,
          },
          {
            path: 'packages/app/app/File.php',
            line: 12,
            column: 1,
            matchText: 'Foo\\Bar\\Baz',
            lineText: 'Foo\\Bar\\Baz', // not a use import
            score: 1,
          },
        ],
      });

      const result = await shouldAcceptEmptyDiffAsNoopForSatisfiedStep({
        step: 'Import Foo\\\\Bar\\\\Baz in app/File.php',
        repoRoot: '/repo',
      });

      expect(result).toEqual({ allow: false });
    });
  });

  describe('shouldAllowEmptyDiffForStep', () => {
    it('rejects empty diffs for steps that look like code changes', () => {
      expect(shouldAllowEmptyDiffForStep('Fix the bug')).toBe(false);
      expect(shouldAllowEmptyDiffForStep('Implement feature')).toBe(false);
    });

    it('allows empty diffs for command-like diagnostic steps', () => {
      expect(shouldAllowEmptyDiffForStep('pnpm test')).toBe(true);
      expect(shouldAllowEmptyDiffForStep('Run tests and capture baseline output')).toBe(true);
    });

    it('defaults to false for non-diagnostic steps', () => {
      expect(shouldAllowEmptyDiffForStep('Inspect repository structure')).toBe(false);
    });
  });

  describe('buildPatchApplyRetryContext', () => {
    it('returns empty when there are no structured details', () => {
      expect(buildPatchApplyRetryContext(undefined, '/repo')).toBe('');
      expect(buildPatchApplyRetryContext({ type: 'execution', message: 'x' }, '/repo')).toBe('');
    });

    it('formats normalized error entries and suggestions', () => {
      const text = buildPatchApplyRetryContext(
        {
          type: 'execution',
          message: 'apply failed',
          details: {
            errors: [
              { kind: 'HUNK_FAILED', file: 'a/src/a.ts', line: 10, message: 'no match' },
              {
                kind: 'MISSING_FILE',
                file: 'b/src/b.ts',
                message: 'missing',
                suggestion: 'add it',
              },
            ],
          },
        } as PatchError,
        '/repo',
      );

      expect(text).toContain('Patch apply error details:');
      expect(text).toContain('src/a.ts:10');
      expect(text).toContain('suggestion: add it');
    });

    it('falls back to stderr pattern hints when errors are unparsed', () => {
      const fragment = buildPatchApplyRetryContext(
        {
          type: 'execution',
          message: 'apply failed',
          details: { stderr: 'patch fragment without header' },
        } as PatchError,
        '/repo',
      );
      expect(fragment).toContain('Patch format issue: a hunk header');

      const corrupt = buildPatchApplyRetryContext(
        {
          type: 'execution',
          message: 'apply failed',
          details: { stderr: 'corrupt patch at line 12' },
        } as PatchError,
        '/repo',
      );
      expect(corrupt).toContain('Patch format issue: "corrupt patch"');
    });

    it('includes file context for failed hunks when possible', async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-hunk-'));
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'src', 'a.ts'),
        ['one', 'two', 'three'].join('\n'),
        'utf8',
      );

      const text = buildPatchApplyRetryContext(
        {
          type: 'execution',
          message: 'apply failed',
          details: {
            errors: [{ kind: 'HUNK_FAILED', file: 'a/src/a.ts', line: 2, message: 'no match' }],
          },
        } as PatchError,
        tmpDir,
      );

      expect(text).toContain('Failed hunks:');
      expect(text).toContain('File: src/a.ts:2');
      expect(text).toContain('>    2 | two');
    });

    it('handles malformed error entries and formats line-only locations', () => {
      const text = buildPatchApplyRetryContext(
        {
          type: 'execution',
          message: 'apply failed',
          details: {
            errors: [
              null,
              {},
              { kind: 'HUNK_FAILED' }, // missing message
              { kind: 'HUNK_FAILED', message: 'bad', line: 5 }, // line only
              { kind: 'HUNK_FAILED', message: 'bad2' }, // no file/line
            ],
          },
        } as PatchError,
        '/repo',
      );

      expect(text).toContain('patch line 5');
      expect(text).toContain('HUNK_FAILED: bad');
      expect(text).toContain('HUNK_FAILED: bad2');
    });

    it('returns empty when details are present but contain no usable information', () => {
      const text = buildPatchApplyRetryContext(
        {
          type: 'execution',
          message: 'apply failed',
          details: { errors: [], stderr: '   ' },
        } as PatchError,
        '/repo',
      );
      expect(text).toBe('');
    });

    it('returns empty when stderr is present but does not match known hints', () => {
      const text = buildPatchApplyRetryContext(
        {
          type: 'execution',
          message: 'apply failed',
          details: { errors: [], stderr: 'some other error' },
        } as PatchError,
        '/repo',
      );
      expect(text).toBe('');
    });

    it('formats failed hunks without kind annotations', () => {
      const text = buildPatchApplyRetryContext(
        {
          type: 'execution',
          message: 'apply failed',
          details: {
            errors: [{ file: 'a/src/a.ts', line: 2 }],
          },
        } as any,
        '/repo',
      );

      expect(text).toContain('Failed hunks:');
      expect(text).toContain('- src/a.ts:2');
      expect(text).not.toContain('(undefined)');
    });

    it('truncates very large retry contexts', () => {
      const text = buildPatchApplyRetryContext(
        {
          type: 'execution',
          message: 'apply failed',
          details: {
            errors: [
              {
                kind: 'HUNK_FAILED',
                file: 'a/src/a.ts',
                line: 10,
                message: 'x'.repeat(7000),
              },
            ],
          },
        } as PatchError,
        '/repo',
      );

      expect(text).toContain('... (truncated)');
      expect(text.length).toBeLessThanOrEqual(6020);
    });
  });

  describe('extractPatchErrorKind', () => {
    it('extracts the kind from validation errors and details', () => {
      expect(extractPatchErrorKind(undefined)).toBeUndefined();
      expect(extractPatchErrorKind({ type: 'validation', message: 'x' } as PatchError)).toBe(
        'INVALID_PATCH',
      );
      expect(
        extractPatchErrorKind({
          type: 'execution',
          message: 'x',
          details: { kind: 'HUNK_FAILED' },
        } as PatchError),
      ).toBe('HUNK_FAILED');
      expect(
        extractPatchErrorKind({
          type: 'execution',
          message: 'x',
          details: { errors: [{ kind: 'CORRUPT_PATCH', message: 'bad' }] },
        } as PatchError),
      ).toBe('CORRUPT_PATCH');
    });

    it('returns undefined when details are missing or invalid', () => {
      expect(
        extractPatchErrorKind({
          type: 'execution',
          message: 'x',
          details: 'not-an-object',
        } as any),
      ).toBeUndefined();
      expect(
        extractPatchErrorKind({
          type: 'execution',
          message: 'x',
          details: { errors: 'not-an-array' },
        } as any),
      ).toBeUndefined();
      expect(
        extractPatchErrorKind({
          type: 'execution',
          message: 'x',
          details: { errors: [null, {}] },
        } as any),
      ).toBeUndefined();
    });
  });
});
