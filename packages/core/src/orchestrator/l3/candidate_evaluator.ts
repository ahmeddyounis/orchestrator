import { VerificationReport, VerificationProfile, VerificationScope } from '../../verify/types';
import { VerificationRunner } from '../../verify/runner';
import { GitService, PatchApplier } from '@orchestrator/repo';
import { RunnerContext, UserInterface } from '@orchestrator/exec';
import { Logger, updateManifest } from '@orchestrator/shared';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface EvaluatorCandidate {
  patch: string;
  index: number;
}

export interface EvaluationResult {
  candidate: EvaluatorCandidate;
  report: VerificationReport;
  score: number;
}

export class CandidateEvaluator {
  constructor(
    private git: GitService,
    private patchApplier: PatchApplier,
    private verificationRunner: VerificationRunner,
    private repoRoot: string,
    private artifactsRoot: string,
    private logger: Logger,
  ) {}

  async evaluate(
    candidate: EvaluatorCandidate,
    profile: VerificationProfile,
    scope: VerificationScope,
    ui: UserInterface,
    ctx: RunnerContext,
    iteration: number,
  ): Promise<EvaluationResult> {
    const checkpoint = await this.git.createCheckpoint(
      `before-candidate-${iteration}-${candidate.index}-evaluation`,
    );
    try {
      // git apply requires a trailing newline; without it patches can be treated as corrupt.
      const patchText = candidate.patch.endsWith('\n') ? candidate.patch : candidate.patch + '\n';
      const patchResult = await this.patchApplier.applyUnifiedDiff(this.repoRoot, patchText);
      if (!patchResult.applied) {
        // Patch application failed - return a failing evaluation with score reflecting that
        return {
          candidate,
          report: {
            passed: false,
            checks: [],
            summary: `Patch application failed: ${patchResult.error?.message || 'Unknown error'}`,
            commandSources: {},
          },
          score: -10000, // Very low score for patches that can't even be applied
        };
      }
      const report = await this.verificationRunner.run(profile, 'auto', scope, ctx);

      await this.storeArtifacts(candidate, report, iteration);

      const score = this.calculateScore(candidate, report);

      return {
        candidate,
        report,
        score,
      };
    } finally {
      await this.git.rollbackToCheckpoint(checkpoint);
    }
  }

  private async storeArtifacts(
    candidate: EvaluatorCandidate,
    report: VerificationReport,
    iteration: number,
  ): Promise<void> {
    const verificationDir = path.join(this.artifactsRoot, 'verification');
    await fs.mkdir(verificationDir, { recursive: true });
    const reportPath = path.join(
      verificationDir,
      `iter_${iteration}_candidate_${candidate.index}_report.json`,
    );
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    try {
      await updateManifest(path.join(this.artifactsRoot, 'manifest.json'), (manifest) => {
        manifest.verificationPaths = [...(manifest.verificationPaths ?? []), reportPath];
      });
    } catch {
      // Non-fatal
    }
  }

  private calculateScore(candidate: EvaluatorCandidate, report: VerificationReport): number {
    // Passing candidates are scored positively, failing ones negatively.
    // The tie-breaker for passing candidates is the diff size.
    if (report.passed) {
      // Base score for passing, with a penalty for size.
      // A larger diff is "less good", so it gets a larger penalty.
      return 1000 - this.getDiffSizePenalty(candidate);
    }

    // For failing candidates, score is based on number of failed checks.
    // More failed checks is worse (more negative).
    const failedChecks = report.checks.filter((r) => !r.passed).length;
    let score = -1 * failedChecks * 100;

    // Further penalize by diff size.
    score -= this.getDiffSizePenalty(candidate);

    return score;
  }

  private getDiffSizePenalty(candidate: EvaluatorCandidate): number {
    // Simple penalty based on number of lines in the patch.
    // Normalize to avoid overwhelming the score.
    return candidate.patch.split('\n').length / 10;
  }
}

export async function selectBestCandidate(
  results: EvaluationResult[],
  artifactsRoot?: string,
  iteration?: number,
): Promise<EvaluationResult | undefined> {
  if (results.length === 0) {
    return undefined;
  }

  // Sort once, best to worst
  const sortedResults = [...results].sort((a, b) => b.score - a.score);

  const bestResult = sortedResults[0];

  if (artifactsRoot && iteration !== undefined) {
    const selectionDir = path.join(artifactsRoot, 'selection');
    await fs.mkdir(selectionDir, { recursive: true });
    const rankingPath = path.join(selectionDir, `iter_${iteration}_ranking.json`);
    const ranking = sortedResults.map((r) => ({
      candidateIndex: r.candidate.index,
      score: r.score,
      status: r.report.passed ? 'PASS' : 'FAIL',
    }));
    await fs.writeFile(rankingPath, JSON.stringify(ranking, null, 2));
    try {
      await updateManifest(path.join(artifactsRoot, 'manifest.json'), (manifest) => {
        manifest.verificationPaths = [...(manifest.verificationPaths ?? []), rankingPath];
      });
    } catch {
      // Non-fatal
    }
  }

  const passingCandidates = results.filter((r) => r.report.passed);

  if (passingCandidates.length > 0) {
    // If there's any passing candidate, the best one MUST be a passing one.
    // Since we sorted by score, and passing scores are > 0, the best overall
    // must be a passing one.
    return bestResult;
  }

  // If no candidates passed, return the one with the "least bad" score.
  return bestResult;
}
