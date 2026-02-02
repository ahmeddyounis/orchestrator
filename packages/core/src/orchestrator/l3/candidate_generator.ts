import { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import { EventBus, Logger, Config, ModelRequest, ModelResponse } from '@orchestrator/shared';
import { CostTracker } from '../../cost/tracker';
import { FusedContext } from '../../context';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Reviewer, ReviewerContext } from './reviewer';
import { PatchStore } from '../../exec/patch_store';

// Budget type derived from Config
type Budget = NonNullable<Config['budget']>;

export interface StepContext {
  runId: string;
  goal: string;
  step: string;
  stepIndex: number;
  fusedContext: FusedContext;
  eventBus: EventBus;
  costTracker: CostTracker;
  executor: ProviderAdapter;
  reviewer: ProviderAdapter;
  artifactsRoot: string;
  budget: Budget;
  logger: Logger;
}

export interface Candidate {
  index: number;
  valid: boolean;
  patch?: string;
  rawOutput: string;
  patchStats?: {
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
  };
  providerId: string;
  durationMs: number;
}

export interface ReviewRanking {
  candidateId: string;
  score: number;
  reasons: string[];
  riskFlags: string[];
}

export interface CandidateGenerationResult {
  candidates: Candidate[];
  reviews: ReviewRanking[];
}

export class CandidateGenerator {
  private reviewer: Reviewer;

  constructor() {
    this.reviewer = new Reviewer();
  }

  private parseDiff(rawOutput: string): string | null {
    const diffMatch = rawOutput.match(/BEGIN_DIFF([\s\S]*?)END_DIFF/);
    if (!diffMatch || !diffMatch[1].trim()) {
      return null;
    }
    const rawDiffContent = diffMatch[1];
    const lines = rawDiffContent.split('\n');
    const firstContentIdx = lines.findIndex((l) => l !== '');
    let lastContentIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] !== '') {
        lastContentIdx = i;
        break;
      }
    }
    return firstContentIdx === -1
      ? ''
      : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');
  }

  private calculatePatchStats(patch: string): {
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
  } {
    const filesChanged = (patch.match(/diff --git/g) || []).length;
    const linesAdded =
      (patch.match(/^\+/gm) || []).length - (patch.match(/^\+\+\+/gm) || []).length;
    const linesDeleted = (patch.match(/^-/gm) || []).length - (patch.match(/^---/gm) || []).length;
    return { filesChanged, linesAdded, linesDeleted };
  }

  async generateCandidates(stepContext: StepContext, n: number): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    const {
      runId,
      goal,
      step,
      fusedContext,
      executor,
      eventBus,
      artifactsRoot,
      stepIndex,
      budget,
      costTracker,
    } = stepContext;

    const manifestPath = path.join(artifactsRoot, 'manifest.json');
    const patchStore = new PatchStore(path.join(artifactsRoot, 'patches'), manifestPath);

    const systemPrompt = `You are an expert software engineer.
Your task is to implement the current step: "${step}"
Part of the overall goal: "${goal}"

CONTEXT:
${fusedContext.prompt}

INSTRUCTIONS:
1. Analyze the context and the step.
2. Produce a unified diff that implements the changes for THIS STEP ONLY.
3. Output ONLY the unified diff between BEGIN_DIFF and END_DIFF markers.
4. Do not include any explanations outside the markers.
`;

    for (let i = 0; i < n; i++) {
      if (budget.cost !== undefined) {
        const summary = costTracker.getSummary();
        if (summary.total.estimatedCostUsd && summary.total.estimatedCostUsd > budget.cost) {
          await eventBus.emit({
            type: 'RunStopped',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: {
              reason: 'budget_exceeded',
              details: `Cost budget exceeded ($${budget.cost})`,
            },
          });
          break;
        }
      }

      const startTime = Date.now();

      // M17-02: Build request with low temperature by default for deterministic output
      const request: ModelRequest = {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Implement the step. This is candidate ${i + 1} of ${n}.` },
        ],
        temperature: 0.1, // Low temperature for deterministic safety
        metadata: {
          orchestrator_candidate_index: i,
        },
      };

      const ctx: AdapterContext = {
        runId,
        logger: stepContext.logger,
      };

      const response: ModelResponse = await executor.generate(request, ctx);
      const durationMs = Date.now() - startTime;
      const rawOutput = response.text ?? '';
      const providerId = executor.id();

      const patch = this.parseDiff(rawOutput);
      const valid = patch !== null && patch.trim().length > 0;

      const patchesDir = path.join(artifactsRoot, 'patches');
      await fs.mkdir(patchesDir, { recursive: true });

      const rawArtifactPath = path.join(patchesDir, `iter_${stepIndex}_candidate_${i}_raw.txt`);
      await fs.writeFile(rawArtifactPath, rawOutput);

      let patchStats;
      if (valid && patch) {
        await patchStore.saveCandidate(stepIndex, i, patch);
        patchStats = this.calculatePatchStats(patch);
      }

      const candidate: Candidate = {
        index: i,
        valid,
        patch: patch ?? undefined,
        rawOutput,
        patchStats,
        providerId: providerId,
        durationMs,
      };
      candidates.push(candidate);

      await eventBus.emit({
        type: 'CandidateGenerated',
        schemaVersion: 1,
        runId: runId,
        timestamp: new Date().toISOString(),
        payload: {
          iteration: stepIndex,
          candidateIndex: i,
          valid,
          providerId,
          durationMs,
          patchStats,
        },
      });
    }

    return candidates;
  }

  async reviewCandidates(
    stepContext: StepContext,
    candidates: Candidate[],
  ): Promise<ReviewRanking[]> {
    const validCandidates = candidates.filter((c) => c.valid && c.patch);
    if (validCandidates.length <= 1) {
      return [];
    }

    const reviewerContext: ReviewerContext = {
      runId: stepContext.runId,
      eventBus: stepContext.eventBus,
      costTracker: stepContext.costTracker,
      reviewer: stepContext.reviewer,
      artifactsRoot: stepContext.artifactsRoot,
      logger: stepContext.logger,
    };

    const review = await this.reviewer.review(
      {
        goal: stepContext.goal,
        step: stepContext.step,
        fusedContext: stepContext.fusedContext,
        candidates: validCandidates,
      },
      reviewerContext,
    );

    return review.rankings;
  }

  async generateAndSelectCandidate(stepContext: StepContext, n: number): Promise<Candidate | null> {
    const result = await this.generateAndReviewCandidates(stepContext, n);

    if (result.candidates.length === 0) {
      return null;
    }

    if (result.candidates.length === 1) {
      return result.candidates[0];
    }

    // Select best candidate from reviews
    if (result.reviews.length === 0) {
      return result.candidates[0];
    }

    const sortedRankings = result.reviews.sort((a, b) => b.score - a.score);
    const bestCandidateId = parseInt(sortedRankings[0].candidateId, 10);

    return result.candidates.find((c) => c.index === bestCandidateId) || result.candidates[0];
  }

  /**
   * Generates candidates and reviews them, returning both for external selection.
   * This allows the orchestrator to integrate judge/verification-based selection.
   */
  async generateAndReviewCandidates(
    stepContext: StepContext,
    n: number,
  ): Promise<CandidateGenerationResult> {
    const candidates = await this.generateCandidates(stepContext, n);
    const validCandidates = candidates.filter((c) => c.valid && c.patch);

    if (validCandidates.length === 0) {
      return { candidates: [], reviews: [] };
    }

    if (validCandidates.length === 1) {
      return { candidates: validCandidates, reviews: [] };
    }

    const rankings = await this.reviewCandidates(stepContext, validCandidates);
    return { candidates: validCandidates, reviews: rankings };
  }
}
