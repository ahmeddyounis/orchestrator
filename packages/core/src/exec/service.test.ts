import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionService } from './service';
import { EventBus } from '../registry';
import { GitService, PatchApplier } from '@orchestrator/repo';

// Mock dependencies
const mockGit = {
  createCheckpoint: vi.fn(),
  rollbackToCheckpoint: vi.fn(),
};

const mockApplier = {
  applyUnifiedDiff: vi.fn(),
};

describe('ExecutionService', () => {
  let service: ExecutionService;
  let eventBus: EventBus;
  const repoRoot = '/test/repo';
  const runId = 'test-run';

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = {
      emit: vi.fn(),
    };

    // Reset mocks
    mockGit.createCheckpoint.mockReset();
    mockGit.rollbackToCheckpoint.mockReset();
    mockApplier.applyUnifiedDiff.mockReset();

    service = new ExecutionService(
      eventBus,
      mockGit as unknown as GitService,
      mockApplier as unknown as PatchApplier,
      runId,
      repoRoot,
    );
  });

  it('should apply patch and create checkpoint on success', async () => {
    mockApplier.applyUnifiedDiff.mockResolvedValue({
      success: true,
      modifiedFiles: ['file1.ts'],
    });
    mockGit.createCheckpoint.mockResolvedValue('sha123');

    const result = await service.applyPatch('diff...', 'Fix bug');

    expect(result).toBe(true);
    expect(mockApplier.applyUnifiedDiff).toHaveBeenCalledWith(repoRoot, 'diff...');
    expect(mockGit.createCheckpoint).toHaveBeenCalledWith('After: Fix bug');
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PatchApplied',
        payload: expect.objectContaining({ files: ['file1.ts'] }),
      }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CheckpointCreated',
        payload: expect.objectContaining({ checkpointRef: 'sha123' }),
      }),
    );
  });

  it('should rollback to HEAD on patch failure', async () => {
    mockApplier.applyUnifiedDiff.mockResolvedValue({
      success: false,
      error: { message: 'Syntax error' },
    });

    const result = await service.applyPatch('diff...', 'Fix bug');

    expect(result).toBe(false);
    expect(mockGit.rollbackToCheckpoint).toHaveBeenCalledWith('HEAD');
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PatchApplyFailed',
      }),
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RollbackPerformed',
        payload: expect.objectContaining({ targetRef: 'HEAD' }),
      }),
    );
    expect(mockGit.createCheckpoint).not.toHaveBeenCalled();
  });

  it('should rollback to HEAD on unexpected error', async () => {
    mockApplier.applyUnifiedDiff.mockRejectedValue(new Error('Crash'));

    const result = await service.applyPatch('diff...', 'Fix bug');

    expect(result).toBe(false);
    expect(mockGit.rollbackToCheckpoint).toHaveBeenCalledWith('HEAD');
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'RollbackPerformed',
      }),
    );
  });
});
