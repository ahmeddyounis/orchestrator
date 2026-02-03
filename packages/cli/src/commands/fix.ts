import { Command } from 'commander';
import {
  ConfigLoader,
  ProviderRegistry,
  CostTracker,
  parseBudget,
  Orchestrator,
  type DeepPartial,
} from '@orchestrator/core';
import { findRepoRoot, GitService } from '@orchestrator/repo';
import {
  AnthropicAdapter,
  ClaudeCodeAdapter,
  FakeAdapter,
  GeminiCliAdapter,
  OpenAIAdapter,
} from '@orchestrator/adapters';
import {
  ProviderConfig,
  ToolPolicy,
  getRunArtifactPaths,
  type Config,
  UsageError,
} from '@orchestrator/shared';
import { OutputRenderer, type OutputResult } from '../output/renderer';
import { ConsoleUI } from '../ui/console';

function parseBudgetFlag(value: string, previous: unknown) {
  const parsed = parseBudget(value);
  const prevObj = typeof previous === 'object' && previous !== null ? previous : {};
  return { ...prevObj, ...parsed };
}

export function registerFixCommand(program: Command) {
  program
    .command('fix')
    .argument('<goal>', 'The goal to fix')
    .description('Fix an issue based on a goal')
    .option('--think <level>', 'Think level: L0, L1', 'L1')
    .option(
      '--budget <limits>',
      'Set budget limits (e.g. cost=5,iter=6,tool=10,time=20m)',
      parseBudgetFlag,
      {},
    )
    .option('--planner <providerId>', 'Override planner provider')
    .option('--executor <providerId>', 'Override executor provider')
    .option('--reviewer <providerId>', 'Override reviewer provider')
    .option('--sandbox <mode>', 'Sandbox mode: none, docker, devcontainer')
    .option('--allow-large-diff', 'Allow large diffs without confirmation')
    .option('--no-tools', 'Force tools disabled')
    .option('--yes', 'Auto-approve confirmations except denylist')
    .option('--non-interactive', 'Deny by default if confirmation required')
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

      if (globalOpts.verbose) renderer.log(`Fixing goal: "${goal}"`);

      const repoRoot = await findRepoRoot();

      const thinkLevel = options.think;
      if (thinkLevel !== 'L0' && thinkLevel !== 'L1') {
        throw new UsageError(`Invalid think level "${options.think}". Must be L0 or L1.`);
      }

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
          thinkLevel,
          budget: Object.keys(options.budget || {}).length > 0 ? options.budget : undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          memory: Object.keys(memory).length > 0 ? (memory as any) : undefined,
          defaults: {
            planner: options.planner,
            executor: options.executor,
            reviewer: options.reviewer,
          },
          patch: options.allowLargeDiff
            ? { maxFilesChanged: Infinity, maxLinesChanged: Infinity, allowBinary: false }
            : undefined,
          execution: {
            tools: {
              enabled: options.tools === false ? false : undefined,
              autoApprove: options.yes,
              interactive: options.nonInteractive ? false : undefined,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            sandbox: options.sandbox ? { mode: options.sandbox } : undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        },
      });

      if (config.execution?.sandbox?.mode && config.execution.sandbox.mode !== 'none') {
        throw new UsageError(
          `Sandbox mode '${config.execution.sandbox.mode}' is not yet implemented.`,
        );
      }

      const runId = Date.now().toString();
      const git = new GitService({ repoRoot });

      if (config.execution?.allowDirtyWorkingTree) {
        renderer.log(
          'WARNING: execution.allowDirtyWorkingTree is enabled. Uncommitted changes may be committed or lost during rollback.',
        );
      }
      await git.ensureCleanWorkingTree({
        allowDirty: config.execution?.allowDirtyWorkingTree,
      });

      const branchName = `fix/${runId}`;
      await git.createAndCheckoutBranch(branchName);
      if (globalOpts.verbose) {
        renderer.log(`Created and checked out branch "${branchName}"`);
      }

      const costTracker = new CostTracker(config);
      const registry = new ProviderRegistry(config, costTracker);

      registry.registerFactory('openai', (cfg: ProviderConfig) => new OpenAIAdapter(cfg));
      registry.registerFactory('anthropic', (cfg: ProviderConfig) => new AnthropicAdapter(cfg));
      registry.registerFactory('claude_code', (cfg: ProviderConfig) => new ClaudeCodeAdapter(cfg));
      registry.registerFactory('gemini_cli', (cfg: ProviderConfig) => new GeminiCliAdapter(cfg));
      registry.registerFactory('fake', (cfg: ProviderConfig) => new FakeAdapter(cfg));

      const ui = new ConsoleUI();
      const defaultToolPolicy: ToolPolicy = {
        enabled: false,
        requireConfirmation: true,
        allowlistPrefixes: [],
        denylistPatterns: [],
        networkPolicy: 'deny',
        envAllowlist: [],
        allowShell: false,
        maxOutputBytes: 1024 * 1024,
        timeoutMs: 600000,
        autoApprove: false,
        interactive: true,
      };
      const toolPolicy = config.execution?.tools || defaultToolPolicy;

      const orchestrator = await Orchestrator.create({
        config,
        git,
        registry,
        repoRoot,
        costTracker,
        toolPolicy,
        ui,
      });

      const result = await orchestrator.run(goal, { thinkLevel, runId });

      const output: OutputResult = {
        status: result.status === 'success' ? 'SUCCESS' : 'FAILURE',
        goal,
        runId: result.runId,
        artifactsDir: getRunArtifactPaths(repoRoot, result.runId).root,
        changedFiles: result.filesChanged || [],
        cost: costTracker.getSummary(),
        verification: result.verification,
        stopReason: result.summary,
        lastFailureSignature: result.lastFailureSignature,
      };

      renderer.render(output);

      if (result.status === 'success') {
        process.exit(0);
      } else {
        process.exit(1);
      }
    });
}
