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
        mode: z.enum(['lexical', 'vector', 'hybrid']).default('lexical'),
        topKLexical: z.number().int().min(1).default(8),
        topKVector: z.number().int().min(1).default(8),
        hybridWeights: z
          .object({
            lexical: z.number().min(0).max(1).default(0.5),
            vector: z.number().min(0).max(1).default(0.5),
          })
          .default({ lexical: 0.5, vector: 0.5 }),
        fallbackToLexicalOnVectorError: z.boolean().optional(),
        staleDownrank: z.boolean().default(true),
      })
      .default({
        mode: 'lexical',
        topKLexical: 8,
        topKVector: 8,
        hybridWeights: { lexical: 0.5, vector: 0.5 },
        staleDownrank: true,
      }),
    vector: z
      .object({
        enabled: z.boolean().default(false),
        backend: z.enum(['sqlite', 'qdrant', 'chroma', 'pgvector']).default('sqlite'),
        embedder: EmbeddingsConfigSchema.default({
          provider: 'local-hash',
          dims: 384,
          batchSize: 32,
        }),
        remoteOptIn: z.boolean().default(false),
        qdrant: z
          .object({
            url: z.string(),
            apiKeyEnv: z.string().optional(),
            collection: z.string().default('orchestrator_memory'),
          })
          .optional(),
        chroma: z
          .object({
            url: z.string(),
            collection: z.string().default('orchestrator_memory'),
          })
          .optional(),
        pgvector: z
          .object({
            connectionStringEnv: z.string(),
            table: z.string().default('orchestrator_memory'),
          })
          .optional(),
      })
      .default({
        enabled: false,
        backend: 'sqlite',
        embedder: {
          provider: 'local-hash',
          dims: 384,
          batchSize: 32,
        },
        remoteOptIn: false,
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
  .transform((cfg) => {
    const { retrieval, vector, ...rest } = cfg;
    const isVectorMode = retrieval.mode === 'vector' || retrieval.mode === 'hybrid';

    return {
      ...rest,
      retrieval: {
        ...retrieval,
        fallbackToLexicalOnVectorError:
          retrieval.fallbackToLexicalOnVectorError ?? retrieval.mode === 'hybrid',
      },
      vector: {
        ...vector,
        enabled: vector.enabled || isVectorMode,
      },
      writePolicy: { ...cfg.writePolicy, enabled: cfg.writePolicy.enabled ?? cfg.enabled },
    };
  })
  .refine(
    (data) => {
      const { backend, remoteOptIn } = data.vector;
      if (backend !== 'sqlite' && !remoteOptIn) {
        return false;
      }
      return true;
    },
    {
      message:
        'Remote vector backends (qdrant, chroma, pgvector) require `vector.remoteOptIn` to be true.',
      path: ['vector', 'remoteOptIn'],
    },
  )
  .refine(
    (data) => {
      if (data.vector.backend === 'qdrant' && !data.vector.qdrant?.url) {
        return false;
      }
      return true;
    },
    {
      message: '`vector.qdrant.url` is required when backend is qdrant.',
      path: ['vector', 'qdrant', 'url'],
    },
  )
  .refine(
    (data) => {
      if (data.vector.backend === 'chroma' && !data.vector.chroma?.url) {
        return false;
      }
      return true;
    },
    {
      message: '`vector.chroma.url` is required when backend is chroma.',
      path: ['vector', 'chroma', 'url'],
    },
  )
  .refine(
    (data) => {
      if (data.vector.backend === 'pgvector' && !data.vector.pgvector?.connectionStringEnv) {
        return false;
      }
      return true;
    },
    {
      message: '`vector.pgvector.connectionStringEnv` is required when backend is pgvector.',
      path: ['vector', 'pgvector', 'connectionStringEnv'],
    },
  )
  .refine(
    (data) => {
      const { lexical, vector } = data.retrieval.hybridWeights;
      const sum = lexical + vector;
      // Allow for slight floating point inaccuracies
      if (sum < 0.99 || sum > 1.01) {
        return false;
      }
      return true;
    },
    {
      message: '`hybridWeights` (lexical + vector) must sum to 1.0.',
      path: ['retrieval', 'hybridWeights'],
    },
  );

export const TelemetryConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['local', 'remote']).default('local'),
  redact: z.boolean().default(true),
});

export const SecurityConfigSchema = z.object({
  redaction: z.object({
    enabled: z.boolean().default(true),
    allowPatterns: z.array(z.string()).optional(),
    maxRedactionsPerFile: z.number().default(200),
  }).default({ enabled: true, maxRedactionsPerFile: 200 }),
}).default({
  redaction: { enabled: true, maxRedactionsPerFile: 200 },
});

export const ConfigSchema = z.object({
  configVersion: z.literal(1).default(1),
  thinkLevel: z.enum(['L0', 'L1', 'L2', 'L3']).default('L1'),
  l3: z
    .object({
      bestOfN: z.number().int().min(1).max(5).default(3),
      enableReviewer: z.boolean().default(true),
      enableJudge: z.boolean().default(true),
      diagnosis: z
        .object({
          enabled: z.boolean().default(true),
          triggerOnRepeatedFailures: z.number().int().min(1).default(2),
          maxToTBranches: z.number().int().min(1).default(3),
        })
        .optional(),
    })
    .optional(),
  escalation: z
    .object({
      enabled: z.boolean().default(true),
      toL3AfterNonImprovingIterations: z.number().int().min(1).default(2),
      toL3AfterPatchApplyFailures: z.number().int().min(1).default(2),
      maxEscalations: z.number().int().min(0).default(1),
    })
    .optional(),
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
  security: SecurityConfigSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
