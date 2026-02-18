import { Command } from 'commander';
import {
  ConfigLoader,
  ProviderRegistry,
  CostTracker,
  PlanService,
  type PlanGenerationOptions,
  type DeepPartial,
} from '@orchestrator/core';
import { findRepoRoot } from '@orchestrator/repo';
import {
  createRunDir,
  writeManifest,
  JsonlLogger,
  OrchestratorEvent,
  MANIFEST_VERSION,
  type Config,
  ConfigError,
  UsageError,
  ContextStackRecorder,
  ContextStackStore,
  renderContextStackForPrompt,
  redactObject,
} from '@orchestrator/shared';
import {
  OpenAIAdapter,
  AnthropicAdapter,
  ClaudeCodeAdapter,
  GeminiCliAdapter,
  CodexCliAdapter,
} from '@orchestrator/adapters';
import type { ProviderAdapter } from '@orchestrator/adapters';
import { OutputRenderer, type OutputResult } from '../output/renderer';
import * as fs from 'fs/promises';
import path from 'path';

export function registerPlanCommand(program: Command) {
  program
    .command('plan')
    .argument('<goal>', 'The goal to plan')
    .description('Plan a task based on a goal')
    .option('--planner <providerId>', 'Override planner provider')
    .option('--research', 'Run a multi-researcher pass before planning')
    .option('--research-count <n>', 'Number of researchers (integer 1-5)')
    .option('--research-provider <providerId...>', 'Provider IDs to use for research calls')
    .option(
      '--research-max-queries <n>',
      'Max follow-up repo searches from research (integer 0-20)',
    )
    .option('--research-no-synth', 'Disable synthesis pass for research')
    .option('--depth <n>', 'Expand each plan step to substeps up to depth n (integer 1-5)')
    .option('--max-substeps <n>', 'Max substeps per expanded step (integer 1-20, default 6)')
    .option(
      '--max-total-steps <n>',
      'Safety limit for total plan nodes (integer 1-500, default 200)',
    )
    .option('--review', 'Review the generated plan')
    .option('--apply-review', 'Apply reviewer revisions (if provided)')
    .option('--reviewer <providerId>', 'Override reviewer provider for plan review')
    .option('--memory <mode>', 'Memory: on|off')
    .option('--memory-path <path>', 'Override memory storage path')
    .option('--memory-mode <mode>', 'Retrieval mode: lexical, vector, hybrid')
    .option('--memory-topk-lexical <n>', 'Override lexical retrieval topK (integer >= 1)')
    .option('--memory-topk-vector <n>', 'Override vector retrieval topK (integer >= 1)')
    .option('--memory-vector-backend <backend>', 'Vector backend: sqlite, qdrant, chroma, pgvector')
    .option('--memory-remote-opt-in', 'Enable remote vector backend')
    .action(async (goal, options) => {
      const globalOpts = program.opts();
      const renderer = new OutputRenderer(!!globalOpts.json);

      if (globalOpts.verbose) renderer.log(`Planning goal: "${goal}"`);

      const repoRoot = await findRepoRoot();

      const memory: DeepPartial<Config['memory']> = {};
      if (options.memory) {
        if (options.memory !== 'on' && options.memory !== 'off') {
          throw new UsageError(`Invalid --memory "${options.memory}". Must be on or off.`);
        }
        memory.enabled = options.memory === 'on';
      }
      if (options.memoryPath) {
        memory.storage = { path: options.memoryPath };
      }

      const retrieval: DeepPartial<Config['memory']['retrieval']> = {};
      if (options.memoryMode) {
        if (!['lexical', 'vector', 'hybrid'].includes(options.memoryMode)) {
          throw new UsageError(
            `Invalid --memory-mode "${options.memoryMode}". Must be lexical, vector, or hybrid.`,
          );
        }
        retrieval.mode = options.memoryMode;
      }
      if (options.memoryTopkLexical !== undefined) {
        const topK = Number(options.memoryTopkLexical);
        if (!Number.isInteger(topK) || topK < 1) {
          throw new UsageError(
            `Invalid --memory-topk-lexical "${options.memoryTopkLexical}". Must be an integer >= 1.`,
          );
        }
        retrieval.topKLexical = topK;
      }
      if (options.memoryTopkVector !== undefined) {
        const topK = Number(options.memoryTopkVector);
        if (!Number.isInteger(topK) || topK < 1) {
          throw new UsageError(
            `Invalid --memory-topk-vector "${options.memoryTopkVector}". Must be an integer >= 1.`,
          );
        }
        retrieval.topKVector = topK;
      }
      if (Object.keys(retrieval).length > 0) {
        memory.retrieval = retrieval;
      }

      const vector: DeepPartial<Config['memory']['vector']> = {};
      if (options.memoryVectorBackend) {
        if (!['sqlite', 'qdrant', 'chroma', 'pgvector'].includes(options.memoryVectorBackend)) {
          throw new UsageError(
            `Invalid --memory-vector-backend "${options.memoryVectorBackend}". Must be sqlite, qdrant, chroma, or pgvector.`,
          );
        }
        vector.backend = options.memoryVectorBackend;
      }
      if (options.memoryRemoteOptIn) {
        vector.remoteOptIn = true;
      }
      if (Object.keys(vector).length > 0) {
        memory.vector = vector;
      }

      // Planning research flags
      const planning: DeepPartial<Config['planning']> = {};
      const research: DeepPartial<NonNullable<Config['planning']>['research']> = {};
      if (options.research === true) research.enabled = true;
      if (options.researchCount !== undefined) {
        const n = Number(options.researchCount);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          throw new UsageError(
            `Invalid --research-count "${options.researchCount}". Must be an integer 1-5.`,
          );
        }
        research.count = n;
      }
      if (options.researchProvider !== undefined) {
        const ids = Array.isArray(options.researchProvider)
          ? options.researchProvider.map(String)
          : [String(options.researchProvider)];
        research.providerIds = ids;
      }
      if (options.researchMaxQueries !== undefined) {
        const n = Number(options.researchMaxQueries);
        if (!Number.isInteger(n) || n < 0 || n > 20) {
          throw new UsageError(
            `Invalid --research-max-queries "${options.researchMaxQueries}". Must be an integer 0-20.`,
          );
        }
        research.maxQueries = n;
      }
      if (options.researchNoSynth === true) research.synthesize = false;

      if (Object.keys(research).length > 0) {
        planning.research = research as NonNullable<Config['planning']>['research'];
      }

      const flags: DeepPartial<Config> = {
        defaults: {
          planner: options.planner,
        },
      };
      if (Object.keys(memory).length > 0) flags.memory = memory;
      if (Object.keys(planning).length > 0) flags.planning = planning;

      const config = ConfigLoader.load({ configPath: globalOpts.config, flags });

      const plannerId = config.defaults?.planner;
      if (!plannerId) {
        throw new ConfigError(
          'No planner provider configured. Please set defaults.planner in your config or use --planner.',
        );
      }

      // Validate planner existence
      if (!config.providers?.[plannerId]) {
        throw new ConfigError(`Planner provider '${plannerId}' not found in configuration.`);
      }

      // Planning options (CLI overrides)
      const planOptions: PlanGenerationOptions = {};
      if (options.depth !== undefined) {
        const depth = Number(options.depth);
        if (!Number.isInteger(depth) || depth < 1 || depth > 5) {
          throw new UsageError(`Invalid --depth "${options.depth}". Must be an integer 1-5.`);
        }
        planOptions.maxDepth = depth;
      }
      if (options.maxSubsteps !== undefined) {
        const n = Number(options.maxSubsteps);
        if (!Number.isInteger(n) || n < 1 || n > 20) {
          throw new UsageError(
            `Invalid --max-substeps "${options.maxSubsteps}". Must be an integer 1-20.`,
          );
        }
        planOptions.maxSubstepsPerStep = n;
      }
      if (options.maxTotalSteps !== undefined) {
        const n = Number(options.maxTotalSteps);
        if (!Number.isInteger(n) || n < 1 || n > 500) {
          throw new UsageError(
            `Invalid --max-total-steps "${options.maxTotalSteps}". Must be an integer 1-500.`,
          );
        }
        planOptions.maxTotalSteps = n;
      }

      // Only set booleans when explicitly enabled so config defaults still apply.
      if (options.review === true) planOptions.reviewPlan = true;
      if (options.applyReview === true) planOptions.applyReview = true;

      const runId = Date.now().toString();
      const artifacts = await createRunDir(repoRoot, runId);
      const logger = new JsonlLogger(artifacts.trace);

      ConfigLoader.writeEffectiveConfig(config, artifacts.root);

      const costTracker = new CostTracker(config);
      const registry = new ProviderRegistry(config, costTracker);

      // Register adapters
      registry.registerFactory('openai', (cfg) => new OpenAIAdapter(cfg));
      registry.registerFactory('anthropic', (cfg) => new AnthropicAdapter(cfg));
      registry.registerFactory('claude_code', (cfg) => new ClaudeCodeAdapter(cfg));
      registry.registerFactory('gemini_cli', (cfg) => new GeminiCliAdapter(cfg));
      registry.registerFactory('codex_cli', (cfg) => new CodexCliAdapter(cfg));

      const baseEventBus = {
        emit: async (event: OrchestratorEvent) => {
          await logger.log(event);
        },
      };

      const contextStackEnabled = config.contextStack?.enabled ?? false;
      const contextStackStore = contextStackEnabled
        ? new ContextStackStore({
            filePath: ContextStackStore.resolvePath(repoRoot, config),
            security: config.security,
            maxFrames: config.contextStack.maxFrames,
            maxBytes: config.contextStack.maxBytes,
          })
        : undefined;

      if (contextStackStore) {
        try {
          await contextStackStore.load();
        } catch {
          // ignore
        }
        try {
          await contextStackStore.snapshotTo(
            path.join(artifacts.root, 'context_stack.snapshot.jsonl'),
          );
        } catch {
          // ignore
        }
      }

      const contextStackRecorder =
        contextStackEnabled && contextStackStore
          ? new ContextStackRecorder(contextStackStore, {
              repoRoot,
              runId,
              runArtifactsRoot: artifacts.root,
              enabled: true,
            })
          : undefined;

      const eventBus = {
        emit: async (event: OrchestratorEvent) => {
          await baseEventBus.emit(event);
          if (!contextStackRecorder) return;
          const safe = config.security?.redaction?.enabled
            ? (redactObject(event) as OrchestratorEvent)
            : event;
          await contextStackRecorder.onEvent(safe);
        },
      };

      const planner = registry.getAdapter(plannerId);

      // Review provider (optional)
      const reviewEnabledEffective =
        options.review === true ||
        options.applyReview === true ||
        options.reviewer !== undefined ||
        config.planning?.review?.enabled === true;

      const reviewerId = options.reviewer
        ? options.reviewer
        : reviewEnabledEffective
          ? (config.defaults?.reviewer ?? plannerId)
          : undefined;

      if (options.reviewer && !config.providers?.[options.reviewer]) {
        throw new ConfigError(
          `Reviewer provider '${options.reviewer}' not found in configuration.`,
        );
      }
      if (reviewerId && reviewerId !== plannerId && !config.providers?.[reviewerId]) {
        throw new ConfigError(`Reviewer provider '${reviewerId}' not found in configuration.`);
      }

      const reviewer = reviewerId ? registry.getAdapter(reviewerId) : undefined;

      // Research providers (optional)
      let researchers: ProviderAdapter[] | undefined;
      if (config.planning?.research?.enabled) {
        const ids = config.planning.research.providerIds;
        if (ids && ids.length > 0) {
          for (const id of ids) {
            if (!config.providers?.[id]) {
              throw new ConfigError(`Research provider '${id}' not found in configuration.`);
            }
          }
          researchers = ids.map((id) => registry.getAdapter(id));
        } else {
          researchers = [planner];
        }
      }

      // Emit ProviderSelected for planner
      await eventBus.emit({
        type: 'ProviderSelected',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          role: 'planner',
          providerId: plannerId,
          capabilities: planner.capabilities(),
        },
      });

      if (reviewEnabledEffective && reviewer) {
        await eventBus.emit({
          type: 'ProviderSelected',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: {
            role: 'reviewer',
            providerId: reviewerId!,
            capabilities: reviewer.capabilities(),
          },
        });
      }

      const planService = new PlanService(eventBus);

      const ctx = {
        runId,
        logger,
        retryOptions: { maxRetries: 3 },
      };

      const planSteps = await planService.generatePlan(
        goal,
        { planner, reviewer, researchers },
        ctx,
        artifacts.root,
        repoRoot,
        config,
        Object.keys(planOptions).length > 0 ? planOptions : undefined,
        contextStackEnabled && contextStackStore
          ? {
              getContextStackText: () =>
                renderContextStackForPrompt(contextStackStore.getAllFrames(), {
                  maxChars: config.contextStack.promptBudgetChars,
                  maxFrames: config.contextStack.promptMaxFrames,
                }),
            }
          : undefined,
      );

      // plan.json is written by PlanService

      if (planSteps.length === 0) {
        renderer.log(
          `Note: Plan output is unstructured. See ${path.join(artifacts.root, 'plan_raw.txt')}`,
        );
      }

      // Write manifest
      await writeManifest(artifacts.manifest, {
        schemaVersion: MANIFEST_VERSION,
        runId,
        startedAt: new Date().toISOString(),
        command: `plan ${goal}`,
        repoRoot,
        artifactsDir: artifacts.root,
        tracePath: artifacts.trace,
        summaryPath: artifacts.summary,
        effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
        patchPaths: [],
        toolLogPaths: [],
        verificationPaths: [],
      });

      const costSummary = costTracker.getSummary();
      await fs.writeFile(
        artifacts.summary,
        JSON.stringify({ memory: config.memory, cost: costSummary }, null, 2),
      );

      const planPath = path.join(artifacts.root, 'plan.json');
      const output: OutputResult = {
        status: 'SUCCESS',
        goal,
        runId,
        artifactsDir: artifacts.root,
        providers: { planner: plannerId },
        cost: costSummary,
        nextSteps: [
          `Review the generated plan at: ${planPath}`,
          ...(reviewEnabledEffective
            ? [`Review output (if any) at: ${path.join(artifacts.root, 'plan_review.json')}`]
            : []),
          `To execute the plan, run: orchestrator run "${goal}"`,
        ],
      };
      renderer.render(output);
    });
}
