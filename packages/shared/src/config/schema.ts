import { z } from 'zod';

export const SemanticIndexingConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    chunking: z
      .object({
        strategy: z.literal('tree-sitter').default('tree-sitter'),
        maxChunkChars: z.number().default(12000),
        minChunkChars: z.number().default(200),
        includeKinds: z
          .array(z.string())
          .default(['function', 'class', 'method', 'interface', 'type', 'export', 'const']),
      })
      .default({
        strategy: 'tree-sitter',
        maxChunkChars: 12000,
        minChunkChars: 200,
        includeKinds: ['function', 'class', 'method', 'interface', 'type', 'export', 'const'],
      }),
    embeddings: z
      .object({
        provider: z.enum(['openai', 'anthropic', 'google', 'local-hash']).default('local-hash'),
        model: z.string().optional(),
        dims: z.number().default(384),
        batchSize: z.number().default(32),
      })
      .default({
        provider: 'local-hash',
        dims: 384,
        batchSize: 32,
      }),
    storage: z
      .object({
        backend: z.literal('sqlite').default('sqlite'),
        path: z.string().default('.orchestrator/index/semantic.sqlite'),
      })
      .default({
        backend: 'sqlite',
        path: '.orchestrator/index/semantic.sqlite',
      }),
    languages: z
      .object({
        enabled: z
          .array(z.string())
          .default(['typescript', 'tsx', 'javascript', 'python', 'go', 'rust']),
      })
      .default({
        enabled: ['typescript', 'tsx', 'javascript', 'python', 'go', 'rust'],
      }),
  })
  .refine(
    (data) => {
      if (data.enabled && data.embeddings.provider !== 'local-hash' && !data.embeddings.model) {
        return false;
      }
      return true;
    },
    {
      message:
        "embeddings.model is required when semantic indexing is enabled and provider is not 'local-hash'",
      path: ['embeddings', 'model'],
    },
  );

export const EmbeddingsConfigSchema = SemanticIndexingConfigSchema.shape.embeddings;
export type EmbeddingsConfig = z.infer<typeof EmbeddingsConfigSchema>;

export const IndexingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  path: z.string().default('.orchestrator/index/index.json'),
  mode: z.enum(['off', 'on-demand', 'full']).default('on-demand'),
  hashAlgorithm: z.enum(['sha256']).default('sha256'),
  maxFileSizeBytes: z.number().default(2_000_000),
  ignore: z.array(z.string()).optional(),
  autoUpdateOnRun: z.boolean().default(true),
  maxAutoUpdateFiles: z.number().default(5000),
  semantic: SemanticIndexingConfigSchema.optional(),
});

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

export const MemoryConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    scope: z.enum(['repo']).default('repo'),
    maxChars: z.number().default(4000),
    storage: z
      .object({
        backend: z.enum(['sqlite']).default('sqlite'),
        path: z.string().default('.orchestrator/memory.sqlite'),
        encryptAtRest: z.boolean().default(false),
      })
      .default({
        backend: 'sqlite',
        path: '.orchestrator/memory.sqlite',
        encryptAtRest: false,
      }),
    retrieval: z
      .object({
        mode: z.enum(['lexical']).default('lexical'),
        topK: z.number().int().min(1).default(8),
        staleDownrank: z.boolean().default(true),
      })
      .default({
        mode: 'lexical',
        topK: 8,
        staleDownrank: true,
      }),
    writePolicy: z
      .object({
        enabled: z.boolean().optional(),
        storeProcedures: z.boolean().default(true),
        storeEpisodes: z.boolean().default(true),
        requireEvidence: z.boolean().default(true),
        redactSecrets: z.boolean().default(true),
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

export const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['local', 'remote']).default('local'),
  redact: z.boolean().default(true),
});

export const ConfigSchema = z.object({
  configVersion: z.literal(1).default(1),
  thinkLevel: z.enum(['L0', 'L1', 'L2']).default('L1'),
  budget: BudgetSchema.optional(),
  memory: MemoryConfigSchema.default(MemoryConfigSchema.parse({})),
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
  verification: z
    .object({
      enabled: z.boolean().default(true),
      mode: z.enum(['auto', 'custom']).default('auto'),
      steps: z
        .array(
          z.object({
            name: z.string(),
            command: z.string(),
            required: z.boolean(),
            timeoutMs: z.number().optional(),
            allowNetwork: z.boolean().optional(),
          }),
        )
        .default([]),
      auto: z
        .object({
          enableLint: z.boolean().default(true),
          enableTypecheck: z.boolean().default(true),
          enableTests: z.boolean().default(true),
          testScope: z.enum(['targeted', 'full']).default('targeted'),
          maxCommandsPerIteration: z.number().default(3),
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
  indexing: IndexingConfigSchema.optional(),
  telemetry: TelemetryConfigSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
