import { verification_pass, file_contains, script_exit, CriterionResult } from './criteria';
import { RunSummary } from '@orchestrator/shared';
import { SafeCommandRunner } from '@orchestrator/exec';
import * as fs from 'fs/promises';
import * as path from 'path';
import { vi } from 'vitest';

describe('Success Criteria Evaluators', () => {
  const mockSummary: RunSummary = {
    schemaVersion: 1,
    runId: 'test-run',
    command: ['run', 'goal'],
    goal: 'test goal',
    repoRoot: process.cwd(),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 1000,
    status: 'success',
  };

  describe('verification_pass', () => {
    it('should pass if verification passed', async () => {
      const summary: RunSummary = {
        ...mockSummary,
        verification: { enabled: true, passed: true },
      };
      const result = await verification_pass(summary);
      expect(result.passed).toBe(true);
    });

    it('should fail if verification failed', async () => {
      const summary: RunSummary = {
        ...mockSummary,
        verification: { enabled: true, passed: false, failedChecks: 1 },
      };
      const result = await verification_pass(summary);
      expect(result.passed).toBe(false);
    });

    it('should fail if verification was not enabled', async () => {
      const summary: RunSummary = { ...mockSummary };
      const result = await verification_pass(summary);
      expect(result.passed).toBe(false);
    });
  });

  describe('file_contains', () => {
    const testDir = path.join(__dirname, 'test-fixtures');
    const testFile = path.join(testDir, 'test.txt');

    beforeAll(async () => {
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(testFile, 'hello world');
    });

    afterAll(async () => {
      await fs.rm(testDir, { recursive: true, force: true });
    });

    it('should pass if file contains substring', async () => {
      const result = await file_contains(mockSummary, {
        path: path.relative(mockSummary.repoRoot, testFile),
        substring: 'hello',
      });
      expect(result.passed).toBe(true);
    });

    it('should fail if file does not contain substring', async () => {
      const result = await file_contains(mockSummary, {
        path: path.relative(mockSummary.repoRoot, testFile),
        substring: 'goodbye',
      });
      expect(result.passed).toBe(false);
    });

    it('should pass if file content matches regex', async () => {
      const result = await file_contains(mockSummary, {
        path: path.relative(mockSummary.repoRoot, testFile),
        regex: 'h.llo',
      });
      expect(result.passed).toBe(true);
    });

    it('should fail if file content does not match regex', async () => {
      const result = await file_contains(mockSummary, {
        path: path.relative(mockSummary.repoRoot, testFile),
        regex: 'g..dbye',
      });
      expect(result.passed).toBe(false);
    });

    it('should fail if file does not exist', async () => {
      const result = await file_contains(mockSummary, {
        path: 'non-existent-file.txt',
        substring: 'hello',
      });
      expect(result.passed).toBe(false);
    });
  });

  describe('script_exit', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should fail if details are missing or not an object', async () => {
      const result = await script_exit(mockSummary, undefined);
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Missing command or expectedExitCode');

      const result2 = await script_exit(mockSummary, 'not-object');
      expect(result2.passed).toBe(false);
      expect(result2.message).toContain('Missing command or expectedExitCode');
    });

    it('should fail if details types are invalid', async () => {
      const result = await script_exit(mockSummary, {
        command: 123,
        expectedExitCode: 0,
      });
      expect(result.passed).toBe(false);

      const result2 = await script_exit(mockSummary, {
        command: 'node -e "process.exit(0)"',
        expectedExitCode: '0',
      });
      expect(result2.passed).toBe(false);
    });

    it('should pass if script exits with expected code', async () => {
      const result = await script_exit(mockSummary, {
        command: 'node -e "process.exit(0)"',
        expectedExitCode: 0,
      });
      expect(result.passed).toBe(true);
    }, 10000);

    it('should fail if script exits with unexpected code', async () => {
      const result = await script_exit(mockSummary, {
        command: 'node -e "process.exit(1)"',
        expectedExitCode: 0,
      });
      expect(result.passed).toBe(false);
    }, 10000);

    it('should fail if command is denied by policy', async () => {
      const result = await script_exit(mockSummary, {
        command: 'git status',
        expectedExitCode: 0,
      });
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Command matched denylist pattern');
    }, 10000);

    it('should stringify non-Error thrown values', async () => {
      vi.spyOn(SafeCommandRunner.prototype, 'run').mockRejectedValueOnce('nope');

      const result = await script_exit(mockSummary, {
        command: 'node -e "process.exit(0)"',
        expectedExitCode: 0,
      });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('Failed to run script: nope');
    }, 10000);
  });
});
