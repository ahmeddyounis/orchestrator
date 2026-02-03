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
});
