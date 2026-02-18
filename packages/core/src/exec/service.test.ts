import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionService, ConfirmationProvider } from './service';
import { EventBus } from '../registry';
import { GitService, PatchApplier } from '@orchestrator/repo';
import { Config, ConfigSchema } from '@orchestrator/shared';

// Mock dependencies
const mockGit = {
  createCheckpoint: vi.fn(),
  rollbackToCheckpoint: vi.fn(),
};

const mockApplier = {
  applyUnifiedDiff: vi.fn(),
};

const mockConfirmationProvider = {
  confirm: vi.fn(),
};

describe('ExecutionService', () => {
  let service: ExecutionService;
  let eventBus: EventBus;
  const repoRoot = '/test/repo';
  const runId = 'test-run';
  const memory = ConfigSchema.parse({}).memory;
  const config: Config = {
    verification: {} as any,
    configVersion: 1,
    thinkLevel: 'L1',
    memory,
    patch: {
      maxFilesChanged: 5,
      maxLinesChanged: 100,
      allowBinary: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = {
      emit: vi.fn(),
    };

    // Reset mocks
    mockGit.createCheckpoint.mockReset();
    mockGit.rollbackToCheckpoint.mockReset();
    mockApplier.applyUnifiedDiff.mockReset();
    mockConfirmationProvider.confirm.mockReset();

    service = new ExecutionService(
      eventBus,
      mockGit as unknown as GitService,
      mockApplier as unknown as PatchApplier,
      runId,
      repoRoot,
      config,
      mockConfirmationProvider as unknown as ConfirmationProvider,
    );
  });

  it('should apply patch and create checkpoint on success', async () => {
    mockApplier.applyUnifiedDiff.mockResolvedValue({
      applied: true,
      filesChanged: ['file1.ts'],
    });
    mockGit.createCheckpoint.mockResolvedValue('sha123');

    const result = await service.applyPatch('diff...', 'Fix bug');

    expect(result.success).toBe(true);
    expect(mockApplier.applyUnifiedDiff).toHaveBeenCalledWith(
      repoRoot,
      'diff...\n',
      expect.objectContaining({
        maxFilesChanged: 5,
        maxLinesTouched: 100,
      }),
    );
    expect(mockGit.createCheckpoint).toHaveBeenCalledWith('After: Fix bug');
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PatchApplied',
        payload: expect.objectContaining({ filesChanged: ['file1.ts'] }),
      }),
    );
  });

  it('should trigger confirmation when limit exceeded and retry if confirmed', async () => {
    // First call fails with limit error
    mockApplier.applyUnifiedDiff.mockResolvedValueOnce({
      applied: false,
      error: { type: 'limit', message: 'Too many files' },
    });

    // Confirmation returns true
    mockConfirmationProvider.confirm.mockResolvedValue(true);

    // Second call succeeds
    mockApplier.applyUnifiedDiff.mockResolvedValueOnce({
      applied: true,
      filesChanged: ['many_files...'],
    });

    mockGit.createCheckpoint.mockResolvedValue('sha123');

    const result = await service.applyPatch('diff...', 'Fix bug');

    expect(result.success).toBe(true);
    expect(mockConfirmationProvider.confirm).toHaveBeenCalled();
    // First call with defaults
    expect(mockApplier.applyUnifiedDiff).toHaveBeenNthCalledWith(
      1,
      repoRoot,
      'diff...\n',
      expect.objectContaining({
        maxFilesChanged: 5,
      }),
    );
    // Second call with Infinity
    expect(mockApplier.applyUnifiedDiff).toHaveBeenNthCalledWith(
      2,
      repoRoot,
      'diff...\n',
      expect.objectContaining({
        maxFilesChanged: Infinity,
        maxLinesTouched: Infinity,
      }),
    );
  });

  it('should trigger confirmation and fail if denied', async () => {
    // First call fails with limit error
    mockApplier.applyUnifiedDiff.mockResolvedValueOnce({
      applied: false,
      error: { type: 'limit', message: 'Too many files' },
    });

    // Confirmation returns false
    mockConfirmationProvider.confirm.mockResolvedValue(false);

    const result = await service.applyPatch('diff...', 'Fix bug');

    expect(result.success).toBe(false);
    expect(mockConfirmationProvider.confirm).toHaveBeenCalled();
    expect(mockApplier.applyUnifiedDiff).toHaveBeenCalledTimes(1); // No retry
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PatchApplyFailed',
        payload: expect.objectContaining({ error: 'Patch rejected by user (limit exceeded)' }),
      }),
    );
  });

  it('should rollback to HEAD on patch failure', async () => {
    mockApplier.applyUnifiedDiff.mockResolvedValue({
      applied: false,
      error: { type: 'execution', message: 'Syntax error' },
    });

    const result = await service.applyPatch('diff...', 'Fix bug');

    expect(result.success).toBe(false);
    expect(mockGit.rollbackToCheckpoint).toHaveBeenCalledWith('HEAD');
  });

  it('includes git apply stderr in the returned error message', async () => {
    mockApplier.applyUnifiedDiff.mockResolvedValue({
      applied: false,
      filesChanged: [],
      error: {
        type: 'execution',
        message: 'git apply failed with code 1',
        details: {
          stderr: 'error: patch failed: foo.txt:1\nerror: foo.txt: patch does not apply\n',
        },
      },
    });

    const result = await service.applyPatch('diff...', 'Fix bug');

    expect(result.success).toBe(false);
    expect(result.error).toContain('git apply failed with code 1');
    expect(result.error).toContain('patch does not apply');
  });

  it('auto-repairs hunk-only patch fragments when enabled', async () => {
    mockApplier.applyUnifiedDiff.mockResolvedValue({
      applied: true,
      filesChanged: ['src/foo.ts'],
    });
    mockGit.createCheckpoint.mockResolvedValue('sha123');

    const fragment = ['@@ -1,1 +1,1 @@', '-a', '+b'].join('\n');
    const result = await service.applyPatch(fragment, 'Fix src/foo.ts');

    expect(result.success).toBe(true);
    const appliedText = mockApplier.applyUnifiedDiff.mock.calls[0][1] as string;
    expect(appliedText).toContain('diff --git a/src/foo.ts b/src/foo.ts');
    expect(appliedText).toContain('--- a/src/foo.ts');
    expect(appliedText).toContain('+++ b/src/foo.ts');
    expect(appliedText).toContain('@@ -1,1 +1,1 @@');
  });

  it('does not add an extra newline when patch already ends with one', async () => {
    mockApplier.applyUnifiedDiff.mockResolvedValue({
      applied: true,
      filesChanged: ['file1.ts'],
    });
    mockGit.createCheckpoint.mockResolvedValue('sha123');

    await service.applyPatch('diff...\n', 'Fix bug');
    expect(mockApplier.applyUnifiedDiff).toHaveBeenCalledWith(
      repoRoot,
      'diff...\n',
      expect.any(Object),
    );
  });

  it('skips auto-repair when disabled', async () => {
    const noRepairConfig: Config = {
      ...config,
      execution: { autoRepairPatchFragments: false } as any,
    };

    const noRepairService = new ExecutionService(
      eventBus,
      mockGit as unknown as GitService,
      mockApplier as unknown as PatchApplier,
      runId,
      repoRoot,
      noRepairConfig,
      mockConfirmationProvider as unknown as ConfirmationProvider,
    );

    mockApplier.applyUnifiedDiff.mockResolvedValue({
      applied: true,
      filesChanged: ['src/foo.ts'],
    });

    const fragment = ['@@ -1,1 +1,1 @@', '-a', '+b'].join('\n');
    await noRepairService.applyPatch(fragment, 'Fix src/foo.ts');

    expect(mockApplier.applyUnifiedDiff).toHaveBeenCalledWith(
      repoRoot,
      fragment + '\n',
      expect.any(Object),
    );
  });

  it('handles limit errors without a confirmation provider', async () => {
    const noConfirmService = new ExecutionService(
      eventBus,
      mockGit as unknown as GitService,
      mockApplier as unknown as PatchApplier,
      runId,
      repoRoot,
      config,
      undefined,
    );

    mockApplier.applyUnifiedDiff.mockResolvedValueOnce({
      applied: false,
      error: { type: 'limit', message: 'Too many files' },
    });

    const result = await noConfirmService.applyPatch('diff...', 'Fix bug');
    expect(result.success).toBe(false);
    expect(mockGit.rollbackToCheckpoint).toHaveBeenCalledWith('HEAD');
  });

  it('skips checkpoint creation when noCheckpoints is enabled', async () => {
    const noCheckpointConfig: Config = {
      ...config,
      execution: { noCheckpoints: true } as any,
    };

    const noCheckpointService = new ExecutionService(
      eventBus,
      mockGit as unknown as GitService,
      mockApplier as unknown as PatchApplier,
      runId,
      repoRoot,
      noCheckpointConfig,
      mockConfirmationProvider as unknown as ConfirmationProvider,
    );

    mockApplier.applyUnifiedDiff.mockResolvedValue({
      applied: true,
      filesChanged: ['file1.ts'],
    });

    await noCheckpointService.applyPatch('diff...', 'Fix bug');
    expect(mockGit.createCheckpoint).not.toHaveBeenCalled();
  });

  it('uses an Unknown error fallback when apply fails without an error object', async () => {
    const noConfirmService = new ExecutionService(
      eventBus,
      mockGit as unknown as GitService,
      mockApplier as unknown as PatchApplier,
      runId,
      repoRoot,
      config,
      undefined,
    );

    mockApplier.applyUnifiedDiff.mockResolvedValueOnce({
      applied: false,
      filesChanged: [],
      error: undefined,
    });

    const result = await noConfirmService.applyPatch('diff...', 'Fix bug');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error');
  });

  it('truncates long stderr tails to 1000 characters', async () => {
    const longLine = 'x'.repeat(200);
    const longStderr = Array.from({ length: 20 }, (_, i) => `line-${i} ${longLine}`).join('\n');
    mockApplier.applyUnifiedDiff.mockResolvedValue({
      applied: false,
      filesChanged: [],
      error: {
        type: 'execution',
        message: '',
        details: { stderr: longStderr },
      },
    });

    const result = await service.applyPatch('diff...', 'Fix bug');
    expect(result.success).toBe(false);
    expect((result.error ?? '').length).toBeLessThanOrEqual(1100);
  });
});
