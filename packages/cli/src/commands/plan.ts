import { Command } from 'commander';
import {
  ConfigLoader,
  ProviderRegistry,
  CostTracker,
  PlanService,
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
} from '@orchestrator/shared';
import { OpenAIAdapter, AnthropicAdapter, ClaudeCodeAdapter } from '@orchestrator/adapters';
import { OutputRenderer, type OutputResult } from '../output/renderer';
import * as fs from 'fs/promises';
import path from 'path';

export function registerPlanCommand(program: Command) {
  program
    .command('plan')
    .argument('<goal>', 'The goal to plan')
    .description('Plan a task based on a goal')
    .option('--planner <providerId>', 'Override planner provider')
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

      const config = ConfigLoader.load({
        configPath: globalOpts.config,
        flags: {
          defaults: {
            planner: options.planner,
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          memory: Object.keys(memory).length > 0 ? (memory as any) : undefined,
        },
      });

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

      const eventBus = {
        emit: async (event: OrchestratorEvent) => {
          await logger.log(event);
        },
      };

      const planner = registry.getAdapter(plannerId);

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

      const planService = new PlanService(eventBus);

      const ctx = {
        runId,
        logger,
        retryOptions: { maxRetries: 3 },
      };

      const planSteps = await planService.generatePlan(
        goal,
        { planner },
        ctx,
        artifacts.root,
        repoRoot,
        config,
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
          `To execute the plan, run: orchestrator run "${goal}"`,
        ],
      };
      renderer.render(output);
    });
}
