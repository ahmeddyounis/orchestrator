import { z } from 'zod';

export const ProviderConfigSchema = z
  .object({
    type: z.string(),
    model: z.string(),
    supportsTools: z.boolean().optional(),
    api_key_env: z.string().optional(),
    api_key: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.array(z.string()).optional(),
    cwdMode: z.enum(['repoRoot', 'runDir']).optional(),
    pricing: z
      .object({
        inputPerMTokUsd: z.number().optional(),
        outputPerMTokUsd: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

export const ToolPolicySchema = z.object({
  enabled: z.boolean().default(false),
  requireConfirmation: z.boolean().default(true),
  allowlistPrefixes: z
    .array(z.string())
    .default([
      'pnpm test',
      'pnpm lint',
      'pnpm -r test',
      'pnpm -r lint',
      'pnpm -r build',
      'turbo run test',
      'turbo run build',
      'tsc',
      'vitest',
      'eslint',
      'prettier',
    ]),
  denylistPatterns: z
    .array(z.string())
    .default(['rm -rf', 'mkfs', ':(){:|:&};:', 'curl .*\\|\\s*sh']),
  allowNetwork: z.boolean().default(false),
  timeoutMs: z.number().default(600_000),
  maxOutputBytes: z.number().default(1_024_1024),
  autoApprove: z.boolean().default(false),
  interactive: z.boolean().default(true),
});

export const BudgetSchema = z.object({
  cost: z.number().optional(),
  iter: z.number().optional(),
  tool: z.number().optional(),
  time: z.number().optional(),
});

export const ConfigSchema = z.object({
  configVersion: z.literal(1).default(1),
  thinkLevel: z.enum(['L0', 'L1']).default('L1'),
  budget: BudgetSchema.optional(),
  providers: z.record(z.string(), ProviderConfigSchema).optional(),
  defaults: z
    .object({
      planner: z.string().optional(),
      executor: z.string().optional(),
      reviewer: z.string().optional(),
    })
    .optional(),
  budgets: z.record(z.string(), z.number()).optional(),
  context: z
    .object({
      tokenBudget: z.number().optional(),
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
      rgPath: z.string().optional(),
    })
    .optional(),
  commandPolicy: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
  patch: z
    .object({
      maxFilesChanged: z.number().default(15),
      maxLinesChanged: z.number().default(800),
      allowBinary: z.boolean().default(false),
    })
    .optional(),
  execution: z
    .object({
      allowDirtyWorkingTree: z.boolean().default(false),
      noCheckpoints: z.boolean().default(false),
      tools: ToolPolicySchema.default(ToolPolicySchema.parse({})),
      sandbox: z
        .object({
          mode: z.enum(['none', 'docker', 'devcontainer']).default('none'),
        })
        .default({ mode: 'none' }),
    })
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
