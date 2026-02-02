import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  type JudgeInput,
  type JudgeOutput,
  type JudgeArtifact,
  type JudgeInvocationReason,
} from './types';
import { type ProviderAdapter, type AdapterContext } from '@orchestrator/adapters';
import { type ModelRequest, type Logger, type EventBus } from '@orchestrator/shared';

const judgeOutputSchema = z.object({
  winnerCandidateId: z.string(),
  rationale: z.array(z.string()),
  riskAssessment: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

const SYSTEM_PROMPT = `You are a senior software engineer acting as a Judge to break a tie between multiple AI-generated candidates for a coding task.
Your decision must be based on a strict rubric. You will be given the user's goal, and a set of candidate solutions with their diffs and test results.

**Rubric:**
1.  **Minimality & Focus (HIGHEST PRIORITY):**
    -   Prefer the SMALLEST diff that achieves the goal.
    -   Penalize changes that touch unrelated files or code.
    -   Count files changed, lines added/deleted - prefer minimal changes.

2.  **Goal Alignment:**
    -   The change must directly and effectively address the user's goal.
    -   Penalize solutions that are incomplete or only partially address the goal.
    -   Penalize solutions that make changes unrelated to the stated goal.

3.  **Code Quality & Safety:**
    -   Penalize changes that introduce complexity or decrease readability.
    -   Penalize candidates that weaken type safety (e.g., using 'any' without justification).
    -   Penalize removal or weakening of existing tests.

4.  **Risk Assessment:**
    -   Evaluate the risk of merging each candidate.
    -   A candidate that fails tests is always high-risk.
    -   A large, complex change is riskier than a small, simple one.

**Important:** You are a TIE-BREAKER, not the primary truth source. Your role is to select between candidates when objective signals are insufficient.

**Output Format:**
Respond with a JSON object matching this schema:
{
  "winnerCandidateId": "<ID of the winning candidate>",
  "rationale": ["<Reasoning citing the rubric>", "<Comparative analysis>"],
  "riskAssessment": ["<Risk assessment for winner>", "<Note if tests failed>"],
  "confidence": <0.0 to 1.0>
}`;

export interface JudgeContext {
  runId: string;
  iteration: number;
  artifactsRoot: string;
  logger: Logger;
  eventBus: EventBus;
}

export class Judge {
  constructor(private readonly llm: ProviderAdapter) {}

  async decide(input: JudgeInput, context: JudgeContext): Promise<JudgeOutput> {
    const { goal, candidates, verifications, invocationReason } = input;
    const { runId, iteration, artifactsRoot, logger, eventBus } = context;
    const startTime = Date.now();

    const content = this.buildPrompt(goal, candidates, verifications, invocationReason);

    const request: ModelRequest = {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content },
      ],
      temperature: 0.1,
      jsonMode: true,
    };

    const adapterCtx: AdapterContext = { runId, logger };

    await eventBus.emit({
      type: 'JudgeInvoked',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: {
        iteration,
        reason: invocationReason,
        candidateCount: candidates.length,
      },
    });

    try {
      const response = await this.llm.generate(request, adapterCtx);
      const durationMs = Date.now() - startTime;

      const output = this.parseOutput(response.text);

      // Validate winnerCandidateId is one of the candidates
      if (!candidates.some((c) => c.id === output.winnerCandidateId)) {
        throw new Error(
          `Invalid winnerCandidateId: ${output.winnerCandidateId}. Valid IDs: ${candidates.map((c) => c.id).join(', ')}`,
        );
      }

      // Store artifact
      await this.saveArtifact(artifactsRoot, iteration, input, output, durationMs);

      await eventBus.emit({
        type: 'JudgeDecided',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          iteration,
          winnerCandidateId: output.winnerCandidateId,
          confidence: output.confidence,
          durationMs,
        },
      });

      return output;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      // Fallback: pick first candidate
      const fallbackOutput: JudgeOutput = {
        winnerCandidateId: candidates[0].id,
        rationale: [
          'Judge LLM failed to produce a valid decision.',
          `Error: ${error instanceof Error ? error.message : String(error)}`,
          'Defaulting to the first candidate as a fallback.',
        ],
        riskAssessment: [
          'HIGH RISK: The Judge model failed, and the fallback mechanism was used.',
          'The selected candidate has not been properly vetted by the judge.',
        ],
        confidence: 0.1,
      };

      await this.saveArtifact(artifactsRoot, iteration, input, fallbackOutput, durationMs);

      await eventBus.emit({
        type: 'JudgeFailed',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          iteration,
          error: error instanceof Error ? error.message : String(error),
          fallbackCandidateId: candidates[0].id,
        },
      });

      return fallbackOutput;
    }
  }

  private parseOutput(text: string | undefined): JudgeOutput {
    const raw = (text ?? '').trim();
    if (!raw) {
      throw new Error('Judge returned empty response.');
    }

    const json = this.extractJson(raw);
    return judgeOutputSchema.parse(json) as JudgeOutput;
  }

  private extractJson(text: string): unknown {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('No JSON object found in judge response.');
    }
    const jsonText = text.slice(firstBrace, lastBrace + 1);
    return JSON.parse(jsonText) as unknown;
  }

  private buildPrompt(
    goal: string,
    candidates: JudgeInput['candidates'],
    verifications: JudgeInput['verifications'],
    invocationReason: JudgeInvocationReason,
  ): string {
    const reasonText = {
      no_passing_candidates: 'No candidate passed all tests.',
      objective_near_tie: 'Candidates have near-identical objective scores (tie).',
      verification_unavailable: 'Verification was not run or is unavailable.',
    }[invocationReason];

    const candidatesText = candidates
      .map((candidate) => {
        const verification = verifications.find((v) => v.candidateId === candidate.id);
        const verificationSummary = verification
          ? `Status: ${verification.status}, Score: ${verification.score}${verification.summary ? `, Summary: ${verification.summary}` : ''}`
          : 'Verification: not run';

        const statsText = candidate.patchStats
          ? `Files: ${candidate.patchStats.filesChanged}, +${candidate.patchStats.linesAdded}/-${candidate.patchStats.linesDeleted} lines`
          : 'Stats: unavailable';

        return `
## Candidate: ${candidate.id}
**Verification:** ${verificationSummary}
**Patch Stats:** ${statsText}
**Diff:**
\`\`\`diff
${candidate.patch}
\`\`\``;
      })
      .join('\n');

    return `**User's Goal:** ${goal}

**Invocation Reason:** ${reasonText}

**Candidates:**
${candidatesText}

Based on the rubric, which candidate is the best choice?`;
  }

  private async saveArtifact(
    artifactsRoot: string,
    iteration: number,
    input: JudgeInput,
    output: JudgeOutput,
    durationMs: number,
  ): Promise<string> {
    const artifact: JudgeArtifact = {
      iteration,
      input,
      output,
      timestamp: new Date().toISOString(),
      durationMs,
    };

    const artifactPath = path.join(artifactsRoot, `judge_iter_${iteration}.json`);
    await fs.writeFile(artifactPath, JSON.stringify(artifact, null, 2));
    return artifactPath;
  }

  /**
   * Determines if the judge should be invoked based on usage policy.
   * Judge is only a last-resort tie-breaker.
   */
  static shouldInvoke(
    verificationEnabled: boolean,
    verifications: Array<{ candidateId: string; passed: boolean; score: number }>,
    reviews: Array<{ candidateId: string; score: number }>,
  ): { invoke: boolean; reason?: JudgeInvocationReason } {
    // If verification is disabled/unavailable
    if (!verificationEnabled || verifications.length === 0) {
      // Only invoke if we have multiple candidates and reviews show a near-tie
      if (reviews.length >= 2) {
        const sortedScores = reviews.map((r) => r.score).sort((a, b) => b - a);
        const scoreDiff = sortedScores[0] - sortedScores[1];
        if (scoreDiff <= 1) {
          // Near-tie threshold
          return { invoke: true, reason: 'objective_near_tie' };
        }
      }
      return { invoke: true, reason: 'verification_unavailable' };
    }

    // Check if any candidate passes
    const passingCandidates = verifications.filter((v) => v.passed);
    if (passingCandidates.length === 1) {
      // Clear winner, no need for judge
      return { invoke: false };
    }

    if (passingCandidates.length === 0) {
      // No passing candidates - judge needed as tie-breaker
      return { invoke: true, reason: 'no_passing_candidates' };
    }

    // Multiple passing candidates - check for near-tie
    const passingScores = passingCandidates.map((v) => v.score).sort((a, b) => b - a);
    const scoreDiff = passingScores[0] - passingScores[1];
    if (scoreDiff <= 0.1) {
      // Near-tie threshold (scores likely 0-1 range)
      return { invoke: true, reason: 'objective_near_tie' };
    }

    // Clear winner among passing candidates
    return { invoke: false };
  }
}
