import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CandidateEvaluator, selectBestCandidate } from './candidate_evaluator';
import type { EvaluationResult, EvaluatorCandidate } from './candidate_evaluator';
import type { GitService, PatchApplier } from '@orchestrator/repo';
import type { VerificationRunner } from '../../verify/runner';
import type {
  VerificationReport,
  VerificationProfile,
  VerificationScope,
} from '../../verify/types';
import type { RunnerContext, UserInterface } from '@orchestrator/exec';
import { Logger } from '@orchestrator/shared';
import * as fs from 'fs/promises';

vi.mock('fs/promises');

describe('CandidateEvaluator', () => {
  const mockGit = {
    createCheckpoint: vi.fn(),
    rollbackToCheckpoint: vi.fn(),
  } as unknown as GitService;

  const mockPatchApplier = {
    applyUnifiedDiff: vi.fn(),
  } as unknown as PatchApplier;

  let mockVerificationRunner: VerificationRunner;

  const mockLogger = { log: vi.fn() } as unknown as Logger;
  const mockUi = {} as UserInterface;
  const mockRunnerContext = { runId: 'test-run' } as RunnerContext;
  const mockVerificationProfile = {} as VerificationProfile;
  const mockVerificationScope = {} as VerificationScope;

  beforeEach(() => {
    vi.resetAllMocks();
    mockVerificationRunner = {
      run: vi.fn(),
    } as unknown as VerificationRunner;
    // Set up default fs mock return values
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('should evaluate a passing candidate', async () => {
    const evaluator = new CandidateEvaluator(
      mockGit,
      mockPatchApplier,
      mockVerificationRunner,
      '/repo',
      '/artifacts',
      mockLogger,
    );
    const candidate: EvaluatorCandidate = { patch: 'diff --git a/file.ts b/file.ts', index: 0 };

    const passingReport: VerificationReport = {
      passed: true,
      checks: [],
      summary: 'All passed',
      commandSources: {},
    };
    (mockVerificationRunner.run as ReturnType<typeof vi.fn>).mockResolvedValue(passingReport);
    (mockGit.createCheckpoint as ReturnType<typeof vi.fn>).mockResolvedValue('checkpoint-sha');
    (mockPatchApplier.applyUnifiedDiff as ReturnType<typeof vi.fn>).mockResolvedValue({
      applied: true,
      filesChanged: ['file.ts'],
    });

    const result = await evaluator.evaluate(
      candidate,
      mockVerificationProfile,
      mockVerificationScope,
      mockUi,
      mockRunnerContext,
      1,
    );

    expect(mockGit.createCheckpoint).toHaveBeenCalled();
    expect(mockPatchApplier.applyUnifiedDiff).toHaveBeenCalledWith('/repo', candidate.patch);
    expect(mockVerificationRunner.run).toHaveBeenCalled();
    expect(mockGit.rollbackToCheckpoint).toHaveBeenCalledWith('checkpoint-sha');
    expect(result.report.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/artifacts/verification/iter_1_candidate_0_report.json',
      expect.any(String),
    );
  });

  it('should evaluate a failing candidate', async () => {
    const evaluator = new CandidateEvaluator(
      mockGit,
      mockPatchApplier,
      mockVerificationRunner,
      '/repo',
      '/artifacts',
      mockLogger,
    );
    const candidate: EvaluatorCandidate = { patch: 'diff --git a/file.ts b/file.ts', index: 0 };

    const failingReport: VerificationReport = {
      passed: false,
      checks: [
        {
          name: 'test',
          passed: false,
          command: 'npm test',
          exitCode: 1,
          durationMs: 100,
          stdoutPath: '',
          stderrPath: '',
          truncated: false,
        },
      ],
      summary: '1 failed',
      commandSources: {},
    };
    (mockVerificationRunner.run as ReturnType<typeof vi.fn>).mockResolvedValue(failingReport);
    (mockGit.createCheckpoint as ReturnType<typeof vi.fn>).mockResolvedValue('checkpoint-sha');
    (mockPatchApplier.applyUnifiedDiff as ReturnType<typeof vi.fn>).mockResolvedValue({
      applied: true,
      filesChanged: ['file.ts'],
    });

    const result = await evaluator.evaluate(
      candidate,
      mockVerificationProfile,
      mockVerificationScope,
      mockUi,
      mockRunnerContext,
      1,
    );

    expect(result.report.passed).toBe(false);
    expect(result.score).toBeLessThan(0);
  });
});

describe('selectBestCandidate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Set up default fs mock return values
    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  it('should return undefined for empty results', async () => {
    expect(await selectBestCandidate([])).toBeUndefined();
  });

  it('should select the passing candidate with the smallest diff (highest score)', async () => {
    const results: EvaluationResult[] = [
      {
        candidate: { patch: 'a much longer diff', index: 1 },
        report: { passed: true, checks: [], summary: '', commandSources: {} },
        score: 950,
      },
      {
        candidate: { patch: 'short diff', index: 0 },
        report: { passed: true, checks: [], summary: '', commandSources: {} },
        score: 990,
      },
    ];
    const best = await selectBestCandidate(results, '/artifacts', 1);
    expect(best?.candidate.patch).toBe('short diff');
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/artifacts/selection/iter_1_ranking.json',
      expect.stringContaining('"candidateIndex": 0'),
    );
  });

  it('should select the best failing candidate if none pass', async () => {
    const results: EvaluationResult[] = [
      {
        candidate: { patch: 'many errors', index: 1 },
        report: { passed: false, checks: [], summary: '', commandSources: {} },
        score: -10,
      },
      {
        candidate: { patch: 'fewer errors', index: 0 },
        report: { passed: false, checks: [], summary: '', commandSources: {} },
        score: -5,
      },
    ];
    const best = await selectBestCandidate(results);
    expect(best?.candidate.patch).toBe('fewer errors');
  });

  it('should prefer a passing candidate over any failing candidate', async () => {
    const results: EvaluationResult[] = [
      {
        candidate: { patch: 'failing', index: 1 },
        report: { passed: false, checks: [], summary: '', commandSources: {} },
        score: -1,
      },
      {
        candidate: { patch: 'passing but large', index: 0 },
        report: { passed: true, checks: [], summary: '', commandSources: {} },
        score: 800,
      },
    ];
    const best = await selectBestCandidate(results);
    expect(best?.candidate.patch).toBe('passing but large');
  });
});
