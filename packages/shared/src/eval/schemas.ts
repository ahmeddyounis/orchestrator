// packages/shared/src/eval/schemas.ts

import { z } from 'zod';
import {
  EVAL_SCHEMA_VERSION,
  EvalAggregates,
  EvalResult,
  EvalSuite,
  EvalTask,
  EvalTaskResult,
} from './types';

const EvalTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  repo: z.object({
    fixturePath: z.string(),
    ref: z.string().optional(),
  }),
  goal: z.string(),
  command: z.enum(['run', 'fix']),
  thinkLevel: z.enum(['L0', 'L1', 'L2', 'auto']).optional(),
  budgets: z
    .object({
      iter: z.number().optional(),
      tool: z.number().optional(),
      timeMs: z.number().optional(),
      costUsd: z.number().optional(),
    })
    .optional(),
  verification: z.object({
    enabled: z.boolean(),
    mode: z.enum(['auto', 'custom']),
    scope: z.enum(['targeted', 'full']).optional(),
    steps: z
      .array(
        z.object({
          name: z.string(),
          command: z.string(),
          required: z.boolean().optional(),
        }),
      )
      .optional(),
  }),
  tools: z.object({
    enabled: z.boolean(),
    requireConfirmation: z.boolean(),
    allowNetwork: z.boolean().optional(),
  }),
  successCriteria: z.object({
    type: z.enum(['verification_pass', 'file_contains', 'script_exit']),
    details: z.object({}).passthrough(),
  }),
  tags: z.array(z.string()).optional(),
});

const EvalSuiteSchema = z.object({
  schemaVersion: z.literal(EVAL_SCHEMA_VERSION),
  name: z.string(),
  description: z.string().optional(),
  tasks: z.array(EvalTaskSchema),
});

const EvalTaskResultSchema = z.object({
  taskId: z.string(),
  status: z.enum(['pass', 'fail', 'error', 'skipped']),
  runId: z.string().optional(),
  durationMs: z.number(),
  stopReason: z.string().optional(),
  verificationPassed: z.boolean().optional(),
  metrics: z
    .object({
      iterations: z.number().optional(),
      toolRuns: z.number().optional(),
      tokens: z.number().optional(),
      estimatedCostUsd: z.number().optional(),
      filesChanged: z.number().optional(),
      linesChanged: z.number().optional(),
    })
    .optional(),
  artifacts: z
    .object({
      runDir: z.string().optional(),
      summaryPath: z.string().optional(),
      finalDiffPath: z.string().optional(),
    })
    .optional(),
  failure: z
    .object({
      kind: z.string(),
      message: z.string(),
    })
    .optional(),
});

const EvalAggregatesSchema = z.object({
  totalTasks: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  error: z.number(),
  totalDurationMs: z.number(),
  totalCostUsd: z.number().optional(),
  avgDurationMs: z.number(),
  passRate: z.number(),
});

const EvalResultSchema = z.object({
  schemaVersion: z.literal(EVAL_SCHEMA_VERSION),
  suiteName: z.string(),
  startedAt: z.number(),
  finishedAt: z.number(),
  tasks: z.array(EvalTaskResultSchema),
  aggregates: EvalAggregatesSchema,
});

export function validateEvalSuite(suite: unknown): EvalSuite {
  return EvalSuiteSchema.parse(suite) as EvalSuite;
}

export function validateEvalResult(result: unknown): EvalResult {
  return EvalResultSchema.parse(result) as EvalResult;
}
