import { ProviderAdapter } from '@orchestrator/adapters';
import { EventBus, Logger, Config, ModelRequest } from '@orchestrator/shared';
import { CostTracker } from '../../cost/tracker';
import { FusedContext } from '../../context';
import * as path from 'path';
import * as fs from 'fs/promises';
import { z } from 'zod';

const diagnosisHypothesisSchema = z.object({
  hypothesis: z.string().describe('A brief explanation of the potential root cause.'),
  confidence: z.number().min(0).max(1).describe('A confidence score between 0 and 1.'),
  repoSearchQueries: z
    .array(z.string())
    .describe(
      'A list of 1-2 targeted repository search queries (ripgrep patterns) to find evidence.',
    ),
});

const diagnosisResponseSchema = z.object({
  hypotheses: z.array(diagnosisHypothesisSchema),
});

export type DiagnosisHypothesis = z.infer<typeof diagnosisHypothesisSchema>;
export type DiagnosisResponse = z.infer<typeof diagnosisResponseSchema>;

export interface DiagnosisContext {
  runId: string;
  goal: string;
  fusedContext: FusedContext;
  eventBus: EventBus;
  costTracker: CostTracker;
  reasoner: ProviderAdapter;
  artifactsRoot: string;
  logger: Logger;
  config: Config;
  iteration: number;
  lastError: string;
}

export interface DiagnosisResult {
  selectedHypothesis: DiagnosisHypothesis | null;
  evidence: Record<string, unknown>;
}

export class Diagnoser {
  constructor() {}

  async diagnose(context: DiagnosisContext): Promise<DiagnosisResult | null> {
    const { reasoner, runId, logger, artifactsRoot, iteration } = context;

    const maxBranches = context.config.l3?.diagnosis?.maxToTBranches ?? 3;

    const systemPrompt = this.buildPrompt(context, maxBranches);

    const request: ModelRequest = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generate hypotheses for the failure.' },
      ],
      temperature: 0.4, // Higher temperature for creative hypotheses
      jsonMode: true,
    };

    const response = await reasoner.generate(request, {
      runId,
      logger,
      repoRoot: path.resolve(artifactsRoot, '../../..'),
    });
    const diagnosis = this.parseResponse(response.text);

    if (!diagnosis || !diagnosis.hypotheses || diagnosis.hypotheses.length === 0) {
      logger.warn('Diagnosis model returned no hypotheses.');
      return null;
    }

    // For now, we select the highest confidence hypothesis.
    // In the future, we will gather evidence and score them.
    const sortedHypotheses = [...diagnosis.hypotheses].sort((a, b) => b.confidence - a.confidence);
    const selectedHypothesis = sortedHypotheses[0];

    const artifact = {
      iteration,
      hypotheses: diagnosis.hypotheses,
      selectedHypothesis,
      evidence: {}, // Placeholder for evidence
    };

    const diagnosisArtifactPath = path.join(
      artifactsRoot,
      'diagnostics',
      `diag_iter_${iteration}.json`,
    );
    await fs.mkdir(path.dirname(diagnosisArtifactPath), { recursive: true });
    await fs.writeFile(diagnosisArtifactPath, JSON.stringify(artifact, null, 2));

    await context.eventBus.emit({
      type: 'DiagnosisCompleted',
      schemaVersion: 1,
      runId: runId,
      timestamp: new Date().toISOString(),
      payload: {
        iteration,
        selectedHypothesis,
      },
    });

    return {
      selectedHypothesis,
      evidence: {}, // Placeholder
    };
  }

  private parseResponse(text: string | undefined): DiagnosisResponse {
    const raw = (text ?? '').trim();
    if (!raw) {
      throw new Error('Diagnosis model returned empty response.');
    }

    const json = this.extractJson(raw);
    return diagnosisResponseSchema.parse(json) as DiagnosisResponse;
  }

  private extractJson(text: string): unknown {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error('No JSON object found in diagnosis response.');
    }
    const jsonText = text.slice(firstBrace, lastBrace + 1);
    return JSON.parse(jsonText) as unknown;
  }

  private buildPrompt(context: DiagnosisContext, maxBranches: number): string {
    const { goal, fusedContext, lastError } = context;

    return `You are an expert software engineer and diagnostician. The system has repeatedly failed to fix a bug. Your task is to generate a set of diverse hypotheses about the root cause of the failure.

Overall Goal: ${goal}

Relevant Context:
${fusedContext.prompt.slice(0, 5000)}

Last Error:
${lastError}

Instructions:
1.  Analyze the goal, context, and the last error.
2.  Generate up to ${maxBranches} distinct hypotheses for the failure's root cause.
3.  For each hypothesis, provide a confidence score and 1-2 targeted search queries (ripgrep patterns) that could find evidence in the codebase.
4.  Focus on creating hypotheses that are concrete and testable.
5.  Output JSON that strictly adheres to the provided JSON schema. Do not include any other text or explanations.
`;
  }
}
