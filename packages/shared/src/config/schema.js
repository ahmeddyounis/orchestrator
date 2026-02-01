'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.ConfigSchema =
  exports.MemoryConfigSchema =
  exports.BudgetSchema =
  exports.ToolPolicySchema =
  exports.ProviderConfigSchema =
  exports.IndexingConfigSchema =
    void 0;
const zod_1 = require('zod');
exports.IndexingConfigSchema = zod_1.z.object({
  enabled: zod_1.z.boolean().default(false),
  path: zod_1.z.string().default('.orchestrator/index/index.json'),
  mode: zod_1.z.enum(['off', 'on-demand', 'full']).default('on-demand'),
  hashAlgorithm: zod_1.z.enum(['sha256']).default('sha256'),
  maxFileSizeBytes: zod_1.z.number().default(2_000_000),
  ignore: zod_1.z.array(zod_1.z.string()).optional(),
  autoUpdateOnRun: zod_1.z.boolean().default(true),
  maxAutoUpdateFiles: zod_1.z.number().default(5000),
});
exports.ProviderConfigSchema = zod_1.z
  .object({
    type: zod_1.z.string(),
    model: zod_1.z.string(),
    supportsTools: zod_1.z.boolean().optional(),
    api_key_env: zod_1.z.string().optional(),
    api_key: zod_1.z.string().optional(),
    command: zod_1.z.string().optional(),
    args: zod_1.z.array(zod_1.z.string()).optional(),
    env: zod_1.z.array(zod_1.z.string()).optional(),
    cwdMode: zod_1.z.enum(['repoRoot', 'runDir']).optional(),
    pricing: zod_1.z
      .object({
        inputPerMTokUsd: zod_1.z.number().optional(),
        outputPerMTokUsd: zod_1.z.number().optional(),
      })
      .optional(),
  })
  .passthrough();
exports.ToolPolicySchema = zod_1.z.object({
  enabled: zod_1.z.boolean().default(false),
  requireConfirmation: zod_1.z.boolean().default(true),
  allowlistPrefixes: zod_1.z
    .array(zod_1.z.string())
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
  denylistPatterns: zod_1.z
    .array(zod_1.z.string())
    .default(['rm -rf', 'mkfs', ':(){:|:&};:', 'curl .*\\|\\s*sh']),
  allowNetwork: zod_1.z.boolean().default(false),
  timeoutMs: zod_1.z.number().default(600_000),
  maxOutputBytes: zod_1.z.number().default(1_024_1024),
  autoApprove: zod_1.z.boolean().default(false),
  interactive: zod_1.z.boolean().default(true),
});
exports.BudgetSchema = zod_1.z.object({
  cost: zod_1.z.number().optional(),
  iter: zod_1.z.number().optional(),
  tool: zod_1.z.number().optional(),
  time: zod_1.z.number().optional(),
});
exports.MemoryConfigSchema = zod_1.z
  .object({
    enabled: zod_1.z.boolean().default(false),
    scope: zod_1.z.enum(['repo']).default('repo'),
    maxChars: zod_1.z.number().default(4000),
    storage: zod_1.z
      .object({
        backend: zod_1.z.enum(['sqlite']).default('sqlite'),
        path: zod_1.z.string().default('.orchestrator/memory.sqlite'),
        encryptAtRest: zod_1.z.boolean().default(false),
      })
      .default({
        backend: 'sqlite',
        path: '.orchestrator/memory.sqlite',
        encryptAtRest: false,
      }),
    retrieval: zod_1.z
      .object({
        mode: zod_1.z.enum(['lexical']).default('lexical'),
        topK: zod_1.z.number().int().min(1).default(8),
        staleDownrank: zod_1.z.boolean().default(true),
      })
      .default({
        mode: 'lexical',
        topK: 8,
        staleDownrank: true,
      }),
    writePolicy: zod_1.z
      .object({
        enabled: zod_1.z.boolean().optional(),
        storeProcedures: zod_1.z.boolean().default(true),
        storeEpisodes: zod_1.z.boolean().default(true),
        requireEvidence: zod_1.z.boolean().default(true),
        redactSecrets: zod_1.z.boolean().default(true),
      })
      .default({
        storeProcedures: true,
        storeEpisodes: true,
        requireEvidence: true,
        redactSecrets: true,
      }),
  })
  .transform((cfg) => ({
    ...cfg,
    writePolicy: { ...cfg.writePolicy, enabled: cfg.writePolicy.enabled ?? cfg.enabled },
  }));
exports.ConfigSchema = zod_1.z.object({
  configVersion: zod_1.z.literal(1).default(1),
  thinkLevel: zod_1.z.enum(['L0', 'L1', 'L2']).default('L1'),
  budget: exports.BudgetSchema.optional(),
  memory: exports.MemoryConfigSchema.default(exports.MemoryConfigSchema.parse({})),
  providers: zod_1.z.record(zod_1.z.string(), exports.ProviderConfigSchema).optional(),
  defaults: zod_1.z
    .object({
      planner: zod_1.z.string().optional(),
      executor: zod_1.z.string().optional(),
      reviewer: zod_1.z.string().optional(),
    })
    .optional(),
  budgets: zod_1.z.record(zod_1.z.string(), zod_1.z.number()).optional(),
  context: zod_1.z
    .object({
      tokenBudget: zod_1.z.number().optional(),
      include: zod_1.z.array(zod_1.z.string()).optional(),
      exclude: zod_1.z.array(zod_1.z.string()).optional(),
      rgPath: zod_1.z.string().optional(),
    })
    .optional(),
  commandPolicy: zod_1.z
    .object({
      allow: zod_1.z.array(zod_1.z.string()).optional(),
      deny: zod_1.z.array(zod_1.z.string()).optional(),
    })
    .optional(),
  patch: zod_1.z
    .object({
      maxFilesChanged: zod_1.z.number().default(15),
      maxLinesChanged: zod_1.z.number().default(800),
      allowBinary: zod_1.z.boolean().default(false),
    })
    .optional(),
  execution: zod_1.z
    .object({
      allowDirtyWorkingTree: zod_1.z.boolean().default(false),
      noCheckpoints: zod_1.z.boolean().default(false),
      tools: exports.ToolPolicySchema.default(exports.ToolPolicySchema.parse({})),
      sandbox: zod_1.z
        .object({
          mode: zod_1.z.enum(['none', 'docker', 'devcontainer']).default('none'),
        })
        .default({ mode: 'none' }),
    })
    .optional(),
  verification: zod_1.z
    .object({
      enabled: zod_1.z.boolean().default(true),
      mode: zod_1.z.enum(['auto', 'custom']).default('auto'),
      steps: zod_1.z
        .array(
          zod_1.z.object({
            name: zod_1.z.string(),
            command: zod_1.z.string(),
            required: zod_1.z.boolean(),
            timeoutMs: zod_1.z.number().optional(),
            allowNetwork: zod_1.z.boolean().optional(),
          }),
        )
        .default([]),
      auto: zod_1.z
        .object({
          enableLint: zod_1.z.boolean().default(true),
          enableTypecheck: zod_1.z.boolean().default(true),
          enableTests: zod_1.z.boolean().default(true),
          testScope: zod_1.z.enum(['targeted', 'full']).default('targeted'),
          maxCommandsPerIteration: zod_1.z.number().default(3),
        })
        .default({
          enableLint: true,
          enableTypecheck: true,
          enableTests: true,
          testScope: 'targeted',
          maxCommandsPerIteration: 3,
        }),
    })
    .default({
      enabled: true,
      mode: 'auto',
      steps: [],
      auto: {
        enableLint: true,
        enableTypecheck: true,
        enableTests: true,
        testScope: 'targeted',
        maxCommandsPerIteration: 3,
      },
    }),
  indexing: exports.IndexingConfigSchema.optional(),
});
//# sourceMappingURL=schema.js.map
