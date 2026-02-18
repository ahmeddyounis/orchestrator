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
  CodexCliAdapter,
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

export function registerRunCommand(program: Command) {
  program
    .command('run')
    .argument('<goal>', 'The goal to run')
    .description('Run an agentic task to achieve a goal')
    .option('--think <level>', 'Think level: L0, L1, L2, L3, or auto', 'auto')
    .option(
      '--budget <limits>',
      'Set budget limits (e.g. cost=5,iter=6,tool=10,time=20m)',
      parseBudgetFlag,
      {},
    )
    .option('--best-of <n>', 'Override L3 best-of-N setting (integer >= 1)')
    .option('--planner <providerId>', 'Override planner provider')
    .option('--executor <providerId>', 'Override executor provider')
    .option('--reviewer <providerId>', 'Override reviewer provider')
    .option('--plan-research', 'Enable multi-researcher pass before planning')
    .option('--plan-research-count <n>', 'Number of planning researchers (integer 1-5)')
    .option(
      '--plan-research-provider <providerId...>',
      'Provider IDs to use for planning research calls',
    )
    .option(
      '--plan-research-max-queries <n>',
      'Max follow-up repo searches from planning research (integer 0-20)',
    )
    .option('--plan-research-no-synth', 'Disable synthesis pass for planning research')
    .option('--exec-research', 'Enable multi-researcher pass before execution')
    .option('--exec-research-count <n>', 'Number of execution researchers (integer 1-5)')
    .option(
      '--exec-research-provider <providerId...>',
      'Provider IDs to use for execution research calls',
    )
    .option('--exec-research-scope <scope>', 'Execution research scope: goal or step')
    .option(
      '--exec-research-max-queries <n>',
      'Max repoSearchQueries kept in execution research (integer 0-20)',
    )
    .option('--exec-research-no-synth', 'Disable synthesis pass for execution research')
    .option('--review-loop', 'Enable patch review + revise loop before applying patches')
    .option('--review-loop-max <n>', 'Maximum review rounds (integer >= 1)')
    .option('--sandbox <mode>', 'Sandbox mode: none, docker, devcontainer')
    .option('--allow-large-diff', 'Allow large diffs without confirmation')
    .option('--no-tools', 'Force tools disabled')
    .option('--yes', 'Auto-approve confirmations except denylist')
    .option('--non-interactive', 'Deny by default if confirmation required')
    .option('--verify <mode>', 'Verification mode: on, off, auto')
    .option('--verify-scope <scope>', 'Verification scope: targeted, full')
    .option('--no-lint', 'Disable automatic linting')
    .option('--no-typecheck', 'Disable automatic typechecking')
    .option('--no-tests', 'Disable automatic testing')
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

      if (globalOpts.verbose) renderer.log(`Running goal: "${goal}"`);

      const repoRoot = await findRepoRoot();

      let thinkLevel = options.think;
      if (thinkLevel === 'auto') {
        thinkLevel = 'L1';
      }
      if (
        thinkLevel !== 'L0' &&
        thinkLevel !== 'L1' &&
        thinkLevel !== 'L2' &&
        thinkLevel !== 'L3'
      ) {
        throw new UsageError(
          `Invalid think level "${options.think}". Must be L0, L1, L2, L3, or auto.`,
        );
      }

      // Handle verification flags
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const verification: any = {};
      if (options.verify) {
        if (options.verify === 'off') {
          verification.enabled = false;
        } else {
          verification.enabled = true;
          if (options.verify === 'auto') {
            verification.mode = 'auto';
          }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const autoVerification: any = {};
      if (options.verifyScope) {
        autoVerification.testScope = options.verifyScope;
      }
      if (options.lint === false) {
        autoVerification.enableLint = false;
      }
      if (options.typecheck === false) {
        autoVerification.enableTypecheck = false;
      }
      if (options.tests === false) {
        autoVerification.enableTests = false;
      }

      if (Object.keys(autoVerification).length > 0) {
        verification.auto = autoVerification;
      }

      // Planning research flags
      const planning: DeepPartial<Config['planning']> = {};
      const planningResearch: DeepPartial<NonNullable<Config['planning']>['research']> = {};
      if (options.planResearch === true) planningResearch.enabled = true;
      if (options.planResearchCount !== undefined) {
        const n = Number(options.planResearchCount);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          throw new UsageError(
            `Invalid --plan-research-count "${options.planResearchCount}". Must be an integer 1-5.`,
          );
        }
        planningResearch.count = n;
      }
      if (options.planResearchProvider !== undefined) {
        const ids = Array.isArray(options.planResearchProvider)
          ? options.planResearchProvider.map(String)
          : [String(options.planResearchProvider)];
        planningResearch.providerIds = ids;
      }
      if (options.planResearchMaxQueries !== undefined) {
        const n = Number(options.planResearchMaxQueries);
        if (!Number.isInteger(n) || n < 0 || n > 20) {
          throw new UsageError(
            `Invalid --plan-research-max-queries "${options.planResearchMaxQueries}". Must be an integer 0-20.`,
          );
        }
        planningResearch.maxQueries = n;
      }
      if (options.planResearchNoSynth === true) planningResearch.synthesize = false;
      if (Object.keys(planningResearch).length > 0) {
        planning.research = planningResearch as NonNullable<Config['planning']>['research'];
      }

      // Execution research flags
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const execResearch: any = {};
      if (options.execResearch === true) execResearch.enabled = true;
      if (options.execResearchCount !== undefined) {
        const n = Number(options.execResearchCount);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          throw new UsageError(
            `Invalid --exec-research-count "${options.execResearchCount}". Must be an integer 1-5.`,
          );
        }
        execResearch.count = n;
      }
      if (options.execResearchProvider !== undefined) {
        const ids = Array.isArray(options.execResearchProvider)
          ? options.execResearchProvider.map(String)
          : [String(options.execResearchProvider)];
        execResearch.providerIds = ids;
      }
      if (options.execResearchScope !== undefined) {
        const scope = String(options.execResearchScope);
        if (scope !== 'goal' && scope !== 'step') {
          throw new UsageError(
            `Invalid --exec-research-scope "${options.execResearchScope}". Must be goal or step.`,
          );
        }
        execResearch.scope = scope;
      }
      if (options.execResearchMaxQueries !== undefined) {
        const n = Number(options.execResearchMaxQueries);
        if (!Number.isInteger(n) || n < 0 || n > 20) {
          throw new UsageError(
            `Invalid --exec-research-max-queries "${options.execResearchMaxQueries}". Must be an integer 0-20.`,
          );
        }
        execResearch.maxQueries = n;
      }
      if (options.execResearchNoSynth === true) execResearch.synthesize = false;

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

      const l3: DeepPartial<Config['l3']> = {};
      if (options.bestOf) {
        const bestOfN = Number(options.bestOf);
        if (!Number.isInteger(bestOfN) || bestOfN < 1) {
          throw new UsageError(`Invalid --best-of "${options.bestOf}". Must be an integer >= 1.`);
        }
        l3.bestOfN = bestOfN;
      }

      // Patch review loop flags
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reviewLoop: any = {};
      if (options.reviewLoopMax !== undefined) {
        const maxReviews = Number(options.reviewLoopMax);
        if (!Number.isInteger(maxReviews) || maxReviews < 1) {
          throw new UsageError(
            `Invalid --review-loop-max "${options.reviewLoopMax}". Must be an integer >= 1.`,
          );
        }
        reviewLoop.maxReviews = maxReviews;
      }
      if (options.reviewLoop || options.reviewLoopMax !== undefined) {
        reviewLoop.enabled = true;
      }

      const config = ConfigLoader.load({
        configPath: globalOpts.config,
        flags: {
          thinkLevel,
          l3: Object.keys(l3).length > 0 ? l3 : undefined,
          budget: Object.keys(options.budget || {}).length > 0 ? options.budget : undefined,
          planning: Object.keys(planning).length > 0 ? (planning as any) : undefined,
          defaults: {
            planner: options.planner,
            executor: options.executor,
            reviewer: options.reviewer,
          },
          patch: options.allowLargeDiff
            ? { maxFilesChanged: Infinity, maxLinesChanged: Infinity, allowBinary: false }
            : undefined,
          execution: {
            reviewLoop: Object.keys(reviewLoop).length > 0 ? reviewLoop : undefined,
            research: Object.keys(execResearch).length > 0 ? execResearch : undefined,
            tools: {
              enabled: options.tools === false ? false : undefined,
              autoApprove: options.yes,
              interactive: options.nonInteractive ? false : undefined,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            sandbox: options.sandbox ? { mode: options.sandbox } : undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          memory: Object.keys(memory).length > 0 ? (memory as any) : undefined,
          verification: Object.keys(verification).length > 0 ? verification : undefined,
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

      const branchName = `agent/${runId}`;
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
      registry.registerFactory('codex_cli', (cfg: ProviderConfig) => new CodexCliAdapter(cfg));
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

      // Save final diff if successful (or attempted)
      // Orchestrator already saves patches, but we might want to capture the final state relative to HEAD?
      // Orchestrator saves 'finalDiff' in runL0/runL1 implicitly via PatchStore.

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
