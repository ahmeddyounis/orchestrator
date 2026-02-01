import { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import { EventBus, Logger, Config, ModelRequest, ModelResponse, CandidateGenerated } from '@orchestrator/shared';
import { CostTracker } from '../../cost/tracker';
import { FusedContext } from '../../context';
import * as path from 'path';
import * as fs from 'fs/promises';

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

export class CandidateGenerator {
  constructor() {}

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
    return firstContentIdx === -1 ? '' : lines.slice(firstContentIdx, lastContentIdx + 1).join('\n');
  }

  private calculatePatchStats(patch: string): {
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
  } {
    const filesChanged = (patch.match(/diff --git/g) || []).length;
    const linesAdded = (patch.match(/^\+/gm) || []).length - (patch.match(/^\+\+\+/gm) || []).length;
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
            payload: { reason: 'budget_exceeded', details: `Cost budget exceeded ($${budget.cost})` },
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

      const rawArtifactPath = path.join(
        patchesDir,
        `iter_${stepIndex}_candidate_${i}_raw.txt`,
      );
      await fs.writeFile(rawArtifactPath, rawOutput);

      let patchStats;
      if (valid && patch) {
        const patchArtifactPath = path.join(
          patchesDir,
          `iter_${stepIndex}_candidate_${i}.patch`,
        );
        await fs.writeFile(patchArtifactPath, patch);
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
}
