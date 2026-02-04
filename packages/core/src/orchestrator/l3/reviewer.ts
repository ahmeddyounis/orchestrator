import { ProviderAdapter } from '@orchestrator/adapters';
import { EventBus, Logger, ModelRequest, updateManifest, extractJsonObject } from '@orchestrator/shared';
import { CostTracker } from '../../cost/tracker';
import { FusedContext } from '../../context';
import { Candidate } from './candidate_generator';
import { z } from 'zod';
import * as path from 'path';
import * as fs from 'fs/promises';

const reviewerOutputSchema = z.object({
  rankings: z.array(
    z.object({
      candidateId: z.string(),
      score: z.number().min(0).max(10),
      reasons: z.array(z.string()),
      riskFlags: z.array(z.string()),
    }),
  ),
  requiredFixes: z.array(
    z.object({
      candidateId: z.string(),
      changeRequest: z.string(),
      fileHints: z.array(z.string()).optional(),
    }),
  ),
  suggestedTests: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
});

export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;

export interface ReviewerInput {
  goal: string;
  step: string;
  fusedContext: FusedContext;
  candidates: Candidate[];
}

export interface ReviewerContext {
  runId: string;
  eventBus: EventBus;
  costTracker: CostTracker;
  reviewer: ProviderAdapter;
  artifactsRoot: string;
  logger: Logger;
}

export class Reviewer {
  constructor() {}

  async review(input: ReviewerInput, context: ReviewerContext): Promise<ReviewerOutput> {
    const { reviewer, runId, logger, artifactsRoot } = context;

    const systemPrompt = this.buildPrompt(input);

    const request: ModelRequest = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Review the candidates.' },
      ],
      temperature: 0.1,
      jsonMode: true,
    };

    const response = await reviewer.generate(request, {
      runId,
      logger,
      repoRoot: path.resolve(artifactsRoot, '../../..'),
    });
    const output = this.parseResponse(response.text);

    const reviewArtifactPath = path.join(
      artifactsRoot,
      `reviewer_iter_${input.candidates[0].index}.json`,
    );
    await fs.writeFile(reviewArtifactPath, JSON.stringify(output, null, 2));
    try {
      await updateManifest(path.join(artifactsRoot, 'manifest.json'), (manifest) => {
        manifest.verificationPaths = [...(manifest.verificationPaths ?? []), reviewArtifactPath];
      });
    } catch {
      // Non-fatal
    }

    return output;
  }

  private parseResponse(text: string | undefined): ReviewerOutput {
    const raw = (text ?? '').trim();
    if (!raw) {
      throw new Error('Reviewer returned empty response.');
    }

    const json = extractJsonObject(raw, 'reviewer');
    return reviewerOutputSchema.parse(json);
  }

  private buildPrompt(input: ReviewerInput): string {
    const candidatesText = input.candidates
      .map(
        (c) => `
Candidate ID: ${c.index}
---
${c.patch}
---
`,
      )
      .join('\n');

    return `You are an expert code reviewer. Your task is to analyze and rank several candidate patches based on correctness, safety, and adherence to the goal.

Overall Goal: ${input.goal}
Current Step: ${input.step}

Code Context:
${input.fusedContext.prompt.slice(0, 5000)}

Candidate Patches:
${candidatesText}

Review a set of candidate code changes and provide a structured critique.

Instructions:
1.  **Analyze each candidate patch** against the provided goal and context.
2.  **Rank candidates**: Assign a score from 0 (worst) to 10 (best). The best candidate should be clearly identified.
3.  **Provide justifications**: For each score, give specific, evidence-based reasons. Cite file paths and line numbers from the diffs.
4.  **Identify risks**: Flag potential issues like logic errors, race conditions, security vulnerabilities, or deviations from the goal.
5.  **Suggest improvements**: If a candidate is promising but flawed, specify the required fixes.
6.  **Recommend tests**: Propose specific unit, integration, or e2e tests to validate the changes.
7.  **State confidence**: Indicate your overall confidence (low, medium, high) in the review.
8.  **Output JSON**: Ensure your output strictly adheres to the provided JSON schema. Do not include any other text or explanations.
`;
  }
}
