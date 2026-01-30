'use strict';
// packages/shared/src/eval/schemas.ts
Object.defineProperty(exports, '__esModule', { value: true });
exports.validateEvalSuite = validateEvalSuite;
exports.validateEvalResult = validateEvalResult;
const zod_1 = require('zod');
const types_1 = require('./types');
const EvalTaskSchema = zod_1.z.object({
  id: zod_1.z.string(),
  title: zod_1.z.string(),
  repo: zod_1.z.object({
    fixturePath: zod_1.z.string(),
    ref: zod_1.z.string().optional(),
  }),
  goal: zod_1.z.string(),
  command: zod_1.z.enum(['run', 'fix']),
  thinkLevel: zod_1.z.enum(['L0', 'L1', 'L2', 'auto']).optional(),
  budgets: zod_1.z
    .object({
      iter: zod_1.z.number().optional(),
      tool: zod_1.z.number().optional(),
      timeMs: zod_1.z.number().optional(),
      costUsd: zod_1.z.number().optional(),
    })
    .optional(),
  verification: zod_1.z.object({
    enabled: zod_1.z.boolean(),
    mode: zod_1.z.enum(['auto', 'custom']),
    scope: zod_1.z.enum(['targeted', 'full']).optional(),
    steps: zod_1.z
      .array(
        zod_1.z.object({
          name: zod_1.z.string(),
          command: zod_1.z.string(),
          required: zod_1.z.boolean().optional(),
        }),
      )
      .optional(),
  }),
  tools: zod_1.z.object({
    enabled: zod_1.z.boolean(),
    requireConfirmation: zod_1.z.boolean(),
    allowNetwork: zod_1.z.boolean().optional(),
  }),
  successCriteria: zod_1.z.object({
    type: zod_1.z.enum(['verification_pass', 'file_contains', 'script_exit']),
    details: zod_1.z.object({}).passthrough(),
  }),
  tags: zod_1.z.array(zod_1.z.string()).optional(),
});
const EvalSuiteSchema = zod_1.z.object({
  schemaVersion: zod_1.z.literal(types_1.EVAL_SCHEMA_VERSION),
  name: zod_1.z.string(),
  description: zod_1.z.string().optional(),
  tasks: zod_1.z.array(EvalTaskSchema),
});
const EvalTaskResultSchema = zod_1.z.object({
  taskId: zod_1.z.string(),
  status: zod_1.z.enum(['pass', 'fail', 'error', 'skipped']),
  runId: zod_1.z.string().optional(),
  durationMs: zod_1.z.number(),
  stopReason: zod_1.z.string().optional(),
  verificationPassed: zod_1.z.boolean().optional(),
  metrics: zod_1.z
    .object({
      iterations: zod_1.z.number().optional(),
      toolRuns: zod_1.z.number().optional(),
      tokens: zod_1.z.number().optional(),
      estimatedCostUsd: zod_1.z.number().optional(),
      filesChanged: zod_1.z.number().optional(),
      linesChanged: zod_1.z.number().optional(),
    })
    .optional(),
  artifacts: zod_1.z
    .object({
      runDir: zod_1.z.string().optional(),
      summaryPath: zod_1.z.string().optional(),
      finalDiffPath: zod_1.z.string().optional(),
    })
    .optional(),
  failure: zod_1.z
    .object({
      kind: zod_1.z.string(),
      message: zod_1.z.string(),
    })
    .optional(),
});
const EvalAggregatesSchema = zod_1.z.object({
  totalTasks: zod_1.z.number(),
  passed: zod_1.z.number(),
  failed: zod_1.z.number(),
  skipped: zod_1.z.number(),
  error: zod_1.z.number(),
  totalDurationMs: zod_1.z.number(),
  totalCostUsd: zod_1.z.number().optional(),
  avgDurationMs: zod_1.z.number(),
  passRate: zod_1.z.number(),
});
const EvalResultSchema = zod_1.z.object({
  schemaVersion: zod_1.z.literal(types_1.EVAL_SCHEMA_VERSION),
  suiteName: zod_1.z.string(),
  startedAt: zod_1.z.number(),
  finishedAt: zod_1.z.number(),
  tasks: zod_1.z.array(EvalTaskResultSchema),
  aggregates: EvalAggregatesSchema,
});
function validateEvalSuite(suite) {
  return EvalSuiteSchema.parse(suite);
}
function validateEvalResult(result) {
  return EvalResultSchema.parse(result);
}
//# sourceMappingURL=schemas.js.map
