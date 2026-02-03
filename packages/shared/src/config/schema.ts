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
        provider: z.enum(['openai', 'local-hash']).default('local-hash'),
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
    /** Enable OSS mode for codex_cli provider (adds --oss and --local-provider flags) */
    ossMode: z.boolean().optional(),
    supportsTools: z.boolean().optional(),
    api_key_env: z.string().optional(),
    api_key: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.array(z.string()).optional(),
    cwdMode: z.enum(['repoRoot', 'runDir']).optional(),
    timeoutMs: z.number().optional(),
    pricing: z
      .object({
        inputPerMTokUsd: z.number().optional(),
        outputPerMTokUsd: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

/**
 * Per-tool timeout configuration schema.
 * Allows specifying timeout and resource limits for specific tools.
 */
export const ToolTimeoutConfigSchema = z.object({
  timeoutMs: z.number().min(1000).describe('Maximum execution time in milliseconds'),
  gracePeriodMs: z.number().min(0).optional().describe('Grace period for cleanup after timeout'),
  maxMemoryBytes: z.number().min(0).optional().describe('Maximum memory usage in bytes'),
  maxCpuSeconds: z.number().min(0).optional().describe('Maximum CPU time in seconds'),
});

/**
 * Map of tool names to their timeout configurations.
 * Tool names can be exact matches (e.g., "npm") or the base command.
 */
export const ToolTimeoutsConfigSchema = z
  .record(z.string(), ToolTimeoutConfigSchema)
  .optional()
  .describe('Per-tool timeout configurations');

export type ToolTimeoutsConfig = z.infer<typeof ToolTimeoutsConfigSchema>;

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
  networkPolicy: z.enum(['deny', 'allow']).default('deny'),
  envAllowlist: z.array(z.string()).default([]),
  allowShell: z.boolean().default(false),
  timeoutMs: z.number().default(600_000),
  maxOutputBytes: z.number().default(1_024_1024),
  autoApprove: z.boolean().default(false),
  interactive: z.boolean().default(true),
  toolTimeouts: ToolTimeoutsConfigSchema,
});

export const BudgetSchema = z.object({
  cost: z.number().optional(),
  iter: z.number().optional(),
  tool: z.number().optional(),
  time: z.number().optional(),
});

/**
 * Sensitivity levels for memory entries.
 */
export const SensitivityLevelSchema = z.enum(['public', 'internal', 'confidential', 'restricted']);

/**
 * Retention policy schema for memory hardening.
 */
export const RetentionPolicySchema = z.object({
  sensitivityLevel: SensitivityLevelSchema,
  maxAgeMs: z.number().min(1).describe('Maximum age in milliseconds before automatic purge'),
  entryTypes: z.array(z.enum(['procedural', 'episodic', 'semantic'])).optional(),
  aggressiveStaleCleanup: z.boolean().optional(),
});

/**
 * Memory hardening configuration schema.
 */
export const MemoryHardeningSchema = z.object({
  enabled: z.boolean().default(false),
  defaultSensitivity: SensitivityLevelSchema.default('internal'),
  retentionPolicies: z.array(RetentionPolicySchema).optional(),
  purgeIntervalMs: z.number().min(60000).default(6 * 60 * 60 * 1000).describe('Purge check interval (minimum 60s)'),
  purgeOnStartup: z.boolean().default(false),
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
    hardening: MemoryHardeningSchema.default({
      enabled: false,
      defaultSensitivity: 'internal',
      purgeIntervalMs: 6 * 60 * 60 * 1000,
      purgeOnStartup: false,
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

export const SecurityConfigSchema = z
  .object({
    redaction: z
      .object({
        enabled: z.boolean().default(true),
        allowPatterns: z.array(z.string()).optional(),
        maxRedactionsPerFile: z.number().default(200),
      })
      .default({ enabled: true, maxRedactionsPerFile: 200 }),
    encryption: z
      .object({
        keyEnv: z.string().default('ORCHESTRATOR_ENC_KEY'),
        artifactEncryption: z.boolean().default(false),
      })
      .default({ keyEnv: 'ORCHESTRATOR_ENC_KEY', artifactEncryption: false }),
    vectorRedaction: z
      .object({
        enabled: z.boolean().default(true),
        redactMetadataFields: z.array(z.string()).default(['content', 'evidence', 'source']),
      })
      .default({ enabled: true, redactMetadataFields: ['content', 'evidence', 'source'] }),
  })
  .default({
    redaction: { enabled: true, maxRedactionsPerFile: 200 },
    encryption: { keyEnv: 'ORCHESTRATOR_ENC_KEY', artifactEncryption: false },
    vectorRedaction: { enabled: true, redactMetadataFields: ['content', 'evidence', 'source'] },
  });

export const SandboxConfigSchema = z
  .object({
    mode: z.enum(['none', 'docker', 'devcontainer']).default('none'),
    docker: z
      .object({
        image: z.string().default('node:20-slim'),
        networkMode: z.enum(['none', 'host', 'bridge']).default('none'),
        readonlyRoot: z.boolean().default(true),
        tmpfsSize: z.string().default('512m'),
        memoryLimit: z.string().default('2g'),
        cpuLimit: z.number().default(2),
        seccompProfile: z.enum(['default', 'unconfined']).default('default'),
      })
      .optional(),
    devcontainer: z
      .object({
        configPath: z.string().default('.devcontainer/devcontainer.json'),
        workspaceMount: z.string().optional(),
      })
      .optional(),
  })
  .default({ mode: 'none' });

export const PluginsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  paths: z.array(z.string()).default(['.orchestrator/plugins']),
  allowlistIds: z.array(z.string()).optional(),
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
      maxCandidates: z.number().optional(),
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
      rgPath: z.string().optional(),
      scanner: z
        .object({
          maxFiles: z.number().optional(),
          maxFileSize: z.number().optional(),
        })
        .optional(),
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
      sandbox: SandboxConfigSchema.default(SandboxConfigSchema.parse({})),
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
  plugins: PluginsConfigSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
export type VectorRedactionConfig = z.infer<typeof SecurityConfigSchema>['vectorRedaction'];
export type MemoryHardeningSchemaType = z.infer<typeof MemoryHardeningSchema>;
export type RetentionPolicySchemaType = z.infer<typeof RetentionPolicySchema>;
