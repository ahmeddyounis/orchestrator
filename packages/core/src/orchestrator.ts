import {
  Config,
  OrchestratorEvent,
  createRunDir,
  writeManifest,
  JsonlLogger,
} from '@orchestrator/shared';
import {
  GitService,
  RepoScanner,
  SearchService,
  PatchApplier,
  SimpleContextPacker,
  SnippetExtractor,
} from '@orchestrator/repo';
import { ProviderRegistry, EventBus } from './registry';
import { PatchStore } from './exec/patch_store';
import { PlanService } from './plan/service';
import { ExecutionService } from './exec/service';
import path from 'path';
import fs from 'fs/promises';
import { createHash } from 'crypto';
import { CostTracker } from './cost/tracker';
import { DEFAULT_BUDGET } from './config/budget';
import { ConfigLoader } from './config/loader';

export interface OrchestratorOptions {
  config: Config;
  git: GitService;
  registry: ProviderRegistry;
  repoRoot: string;
  costTracker?: CostTracker;
}

export interface RunResult {
  status: 'success' | 'failure';
  runId: string;
  summary?: string;
  filesChanged?: string[];
  patchPaths?: string[];
  stopReason?: 'success' | 'budget_exceeded' | 'repeated_failure' | 'invalid_output' | 'error';
  recommendations?: string;
}

export interface RunOptions {
  thinkLevel: 'L0' | 'L1';
  runId?: string;
}

export class Orchestrator {
  private config: Config;
  private git: GitService;
  private registry: ProviderRegistry;
  private repoRoot: string;
  private costTracker?: CostTracker;

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.git = options.git;
    this.registry = options.registry;
    this.repoRoot = options.repoRoot;
    this.costTracker = options.costTracker;
  }

  async run(goal: string, options: RunOptions): Promise<RunResult> {
    const runId = options.runId || Date.now().toString();
    if (options.thinkLevel === 'L0') {
      return this.runL0(goal, runId);
    } else {
      return this.runL1(goal, runId);
    }
  }

  async runL0(goal: string, runId: string): Promise<RunResult> {
    // 1. Setup Artifacts
    const artifacts = await createRunDir(this.repoRoot, runId);
    ConfigLoader.writeEffectiveConfig(this.config, artifacts.root);
    const logger = new JsonlLogger(artifacts.trace);

    const emitEvent = async (e: OrchestratorEvent) => {
      await logger.log(e);
    };

    await emitEvent({
      type: 'RunStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { taskId: runId, goal },
    });

    // Initialize manifest
    await writeManifest(artifacts.manifest, {
      runId,
      startedAt: new Date().toISOString(),
      command: `run ${goal}`,
      repoRoot: this.repoRoot,
      artifactsDir: artifacts.root,
      tracePath: artifacts.trace,
      summaryPath: artifacts.summary,
      effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
      patchPaths: [],
      toolLogPaths: [],
    });

    // 2. Build Minimal Context
    const scanner = new RepoScanner();
    const searchService = new SearchService();

    // Wire up search events to logger
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    searchService.on('RepoSearchStarted', (_e) => {
      /* log if needed */
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    searchService.on('RepoSearchFinished', (_e) => {
      /* log if needed */
    });

    // Scan repo structure
    const snapshot = await scanner.scan(this.repoRoot);
    const fileList = snapshot.files.map((f) => f.path).join('\n');

    // Search for keywords (simple tokenization of goal)
    const keywords = goal
      .split(' ')
      .filter((w) => w.length > 3)
      .slice(0, 5);
    let searchResults = '';

    if (keywords.length > 0) {
      const terms = keywords.slice(0, 3);
      if (terms.length > 0) {
        const regex = `(${terms.join('|')})`;
        try {
          const results = await searchService.search({
            query: regex,
            cwd: this.repoRoot,
            maxMatchesPerFile: 3,
          });

          searchResults = results.matches
            .map((m) => `${m.path}:${m.line} ${m.matchText.trim()}`)
            .join('\n');
        } catch {
          searchResults = '(Search failed)';
        }
      }
    }

    const context = `
REPOSITORY STRUCTURE:
${fileList}

SEARCH RESULTS (for keywords: ${keywords.join(', ')}):
${searchResults || '(No matches)'}
`;

    // 3. Prompt Executor
    const executor = this.registry.getAdapter(this.config.defaults?.executor || 'openai');

    if (!executor) {
      throw new Error('No executor provider configured');
    }

    const systemPrompt = `
You are an expert software engineer.
Your task is to implement the following goal: "${goal}"

CONTEXT:
${context}

INSTRUCTIONS:
1. Analyze the context and the goal.
2. Produce a unified diff that implements the changes.
3. Output ONLY the unified diff between BEGIN_DIFF and END_DIFF markers.
4. Do not include any explanations outside the markers.

Example Output:
BEGIN_DIFF
diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,1 @@
-old
+new
END_DIFF
`;

    const response = await executor.generate(
      {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Implement the goal.' },
        ],
      },
      { runId, logger },
    );

    const outputText = response.text;

    if (outputText) {
      await fs.writeFile(path.join(artifacts.root, 'executor_output.txt'), outputText);
    }

    // 4. Parse Diff
    const diffMatch = outputText?.match(/BEGIN_DIFF([\s\S]*?)END_DIFF/);

    if (!diffMatch || !diffMatch[1].trim()) {
      const msg = 'Failed to extract diff from executor output';
      await emitEvent({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { status: 'failure', summary: msg },
      });

      const result: RunResult = { status: 'failure', runId, summary: msg };

      await fs.writeFile(
        artifacts.summary,
        JSON.stringify(
          {
            ...result,
            verification: this.config.verification,
          },
          null,
          2,
        ),
      );

      // Write manifest before returning
      await writeManifest(artifacts.manifest, {
        runId,
        startedAt: new Date().toISOString(),
        command: `run ${goal}`,
        repoRoot: this.repoRoot,
        artifactsDir: artifacts.root,
        tracePath: artifacts.trace,
        summaryPath: artifacts.summary,
        effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
        patchPaths: [],
        toolLogPaths: [],
      });
      return { status: 'failure', runId, summary: msg };
    }

    const diffContent = diffMatch[1].trim();

    // 5. Apply Patch
    const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
    const patchPath = await patchStore.saveSelected(0, diffContent);
    await patchStore.saveFinalDiff(diffContent);

    await emitEvent({
      type: 'PatchProposed',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: {
        diffPreview: diffContent,
        filePaths: [],
      },
    });

    const applier = new PatchApplier();
    const result = await applier.applyUnifiedDiff(this.repoRoot, diffContent, {
      maxFilesChanged: this.config.patch?.maxFilesChanged,
      maxLinesTouched: this.config.patch?.maxLinesChanged,
      allowBinary: this.config.patch?.allowBinary,
    });

    let runResult: RunResult;

    if (result.applied) {
      await emitEvent({
        type: 'PatchApplied',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          description: 'L0 Auto-applied patch',
          filesChanged: result.filesChanged,
          success: true,
        },
      });

      await emitEvent({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          status: 'success',
          summary: 'Patch applied successfully',
        },
      });

      runResult = {
        status: 'success',
        runId,
        summary: 'Patch applied successfully',
        filesChanged: result.filesChanged,
        patchPaths: [patchPath],
      };
    } else {
      const msg = result.error?.message || 'Unknown error';
      await emitEvent({
        type: 'PatchApplyFailed',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
          error: msg,
          details: result.error?.details,
        },
      });

      await emitEvent({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { status: 'failure', summary: 'Patch application failed' },
      });

      runResult = {
        status: 'failure',
        runId,
        summary: `Patch application failed: ${msg}`,
        patchPaths: [patchPath],
      };
    }

    await fs.writeFile(
      artifacts.summary,
      JSON.stringify(
        {
          ...runResult,
          verification: this.config.verification,
        },
        null,
        2,
      ),
    );

    // Write manifest
    await writeManifest(artifacts.manifest, {
      runId,
      startedAt: new Date().toISOString(),
      command: `run ${goal}`,
      repoRoot: this.repoRoot,
      artifactsDir: artifacts.root,
      tracePath: artifacts.trace,
      summaryPath: artifacts.summary,
      effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
      patchPaths: [patchPath],
      toolLogPaths: [],
    });

    return runResult;
  }

  async runL1(goal: string, runId: string): Promise<RunResult> {
    const artifacts = await createRunDir(this.repoRoot, runId);
    ConfigLoader.writeEffectiveConfig(this.config, artifacts.root);
    const logger = new JsonlLogger(artifacts.trace);

    const eventBus: EventBus = {
      emit: async (e) => await logger.log(e),
    };

    await eventBus.emit({
      type: 'RunStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { taskId: runId, goal },
    });

    // Initialize manifest
    await writeManifest(artifacts.manifest, {
      runId,
      startedAt: new Date().toISOString(),
      command: `run ${goal}`,
      repoRoot: this.repoRoot,
      artifactsDir: artifacts.root,
      tracePath: artifacts.trace,
      summaryPath: artifacts.summary,
      effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
      patchPaths: [],
      contextPaths: [],
      toolLogPaths: [],
    });

    const plannerId = this.config.defaults?.planner || 'openai';
    const executorId = this.config.defaults?.executor || 'openai';
    const reviewerId = this.config.defaults?.reviewer || 'openai';

    const providers = await this.registry.resolveRoleProviders(
      { plannerId, executorId, reviewerId },
      { eventBus, runId },
    );

    const planService = new PlanService(eventBus);

    const context = {
      runId,
      config: this.config,
      logger,
    };

    const steps = await planService.generatePlan(
      goal,
      { planner: providers.planner },
      context,
      artifacts.root,
      this.repoRoot,
      this.config,
    );

    if (steps.length === 0) {
      const msg = 'Planning failed to produce any steps.';
      await eventBus.emit({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { status: 'failure', summary: msg },
      });

      const result: RunResult = { status: 'failure', runId, summary: msg };
      await fs.writeFile(
        artifacts.summary,
        JSON.stringify(
          {
            ...result,
            verification: this.config.verification,
          },
          null,
          2,
        ),
      );

      return result;
    }

    const executionService = new ExecutionService(
      eventBus,
      this.git,
      new PatchApplier(),
      runId,
      this.repoRoot,
      this.config,
    );

    // Budget & Loop State
    const startTime = Date.now();
    const budget = { ...DEFAULT_BUDGET, ...this.config.budget };

    let stepsCompleted = 0;
    const patchPaths: string[] = [];
    const contextPaths: string[] = [];
    const touchedFiles = new Set<string>();

    let consecutiveInvalidDiffs = 0;
    let consecutiveApplyFailures = 0;
    let lastApplyErrorHash = '';

    const finish = async (
      status: 'success' | 'failure',
      stopReason: RunResult['stopReason'] | undefined,
      summary: string,
    ): Promise<RunResult> => {
      if (stopReason) {
        await eventBus.emit({
          type: 'RunStopped',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: { reason: stopReason, details: summary },
        });
      }

      await eventBus.emit({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { status, summary },
      });

      await writeManifest(artifacts.manifest, {
        runId,
        startedAt: new Date().toISOString(),
        command: `run ${goal}`,
        repoRoot: this.repoRoot,
        artifactsDir: artifacts.root,
        tracePath: artifacts.trace,
        summaryPath: artifacts.summary,
        effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
        patchPaths,
        contextPaths,
        toolLogPaths: [],
      });

      const result: RunResult = {
        status,
        runId,
        summary,
        filesChanged: Array.from(touchedFiles),
        patchPaths,
        stopReason,
      };

      await fs.writeFile(
        artifacts.summary,
        JSON.stringify(
          {
            ...result,
            verification: this.config.verification,
          },
          null,
          2,
        ),
      );

      await writeManifest(artifacts.manifest, {
        runId,
        startedAt: new Date().toISOString(),
        command: `run ${goal}`,
        repoRoot: this.repoRoot,
        artifactsDir: artifacts.root,
        tracePath: artifacts.trace,
        summaryPath: artifacts.summary,
        effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
        patchPaths,
        contextPaths,
        toolLogPaths: [],
      });

      return result;
    };

    for (const step of steps) {
      // 1. Budget Checks
      const elapsed = Date.now() - startTime;
      if (budget.time !== undefined && elapsed > budget.time) {
        return finish('failure', 'budget_exceeded', `Time budget exceeded (${budget.time}ms)`);
      }
      if (budget.iter !== undefined && stepsCompleted >= budget.iter) {
        return finish('failure', 'budget_exceeded', `Iteration budget exceeded (${budget.iter})`);
      }
      if (budget.cost !== undefined && this.costTracker) {
        const summary = this.costTracker.getSummary();
        if (summary.total.estimatedCostUsd && summary.total.estimatedCostUsd > budget.cost) {
          return finish('failure', 'budget_exceeded', `Cost budget exceeded ($${budget.cost})`);
        }
      }

      await eventBus.emit({
        type: 'StepStarted',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: { step, index: stepsCompleted, total: steps.length },
      });

      let contextPack;
      try {
        const scanner = new RepoScanner();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const snapshot = await scanner.scan(this.repoRoot, {
          excludes: this.config.context?.exclude,
        });

        const searchService = new SearchService(this.config.context?.rgPath);
        const searchResults = await searchService.search({
          query: step,
          cwd: this.repoRoot,
          maxMatchesPerFile: 5,
        });

        const extraMatches = [];
        for (const touched of touchedFiles) {
          extraMatches.push({
            path: touched,
            line: 1,
            column: 1,
            matchText: 'PREVIOUSLY_TOUCHED',
            lineText: '',
            score: 1000,
          });
        }

        const extractor = new SnippetExtractor();
        const candidates = await extractor.extractSnippets(
          [...searchResults.matches, ...extraMatches],
          { cwd: this.repoRoot },
        );

        const packer = new SimpleContextPacker();
        contextPack = packer.pack(step, [], candidates, {
          tokenBudget: this.config.context?.tokenBudget || 8000,
        });
      } catch {
        // Ignore context errors
      }

      let contextText = `Goal: ${goal}\nCurrent Step: ${step}\n`;
      if (contextPack) {
        const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
        const packFilename = `context_pack_step_${stepsCompleted}_${stepSlug}.json`;
        const packPath = path.join(artifacts.root, packFilename);
        await fs.writeFile(packPath, JSON.stringify(contextPack, null, 2));
        contextPaths.push(packPath);

        let formattedContext = `\nCONTEXT:\n`;

        formattedContext += `Context Rationale:\n`;
        for (const item of contextPack.items) {
          formattedContext += `- ${item.path}:${item.startLine}-${item.endLine} (Score: ${item.score.toFixed(2)}): ${item.reason}\n`;
        }
        formattedContext += `\n`;

        for (const item of contextPack.items) {
          formattedContext += `File: ${item.path} (Lines ${item.startLine}-${item.endLine})\n\
${item.content}\
\
`;
        }

        const txtFilename = `context_pack_step_${stepsCompleted}_${stepSlug}.txt`;
        const txtPath = path.join(artifacts.root, txtFilename);
        await fs.writeFile(txtPath, formattedContext);

        contextText += formattedContext;
      }

      let attempt = 0;
      let success = false;
      let lastError = '';

      while (attempt < 2 && !success) {
        attempt++;

        let systemPrompt = `You are an expert software engineer.
Your task is to implement the current step: "${step}"
Part of the overall goal: "${goal}"

CONTEXT:
${contextText}

INSTRUCTIONS:
1. Analyze the context and the step.
2. Produce a unified diff that implements the changes for THIS STEP ONLY.
3. Output ONLY the unified diff between BEGIN_DIFF and END_DIFF markers.
4. Do not include any explanations outside the markers.
`;

        if (attempt > 1) {
          systemPrompt += `\n\nPREVIOUS ATTEMPT FAILED. Error: ${lastError}\nPlease fix the error and try again.`;
        }

        const response = await providers.executor.generate(
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: 'Implement the step.' },
            ],
          },
          { runId, logger },
        );

        const outputText = response.text;

        if (outputText) {
          const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
          await fs.writeFile(
            path.join(
              artifacts.root,
              `step_${stepsCompleted}_${stepSlug}_attempt_${attempt}_output.txt`,
            ),
            outputText,
          );
        }

        const diffMatch = outputText?.match(/BEGIN_DIFF([\s\S]*?)END_DIFF/);

        if (!diffMatch || !diffMatch[1].trim()) {
          lastError = 'Failed to extract diff from executor output';
          consecutiveInvalidDiffs++;
          if (consecutiveInvalidDiffs >= 2) {
            return finish(
              'failure',
              'invalid_output',
              'Executor produced invalid output twice consecutively',
            );
          }
          continue;
        } else {
          consecutiveInvalidDiffs = 0;
        }

        const diffContent = diffMatch[1].trim();

        if (diffContent.length === 0) {
          return finish('failure', 'invalid_output', 'Executor produced empty patch');
        }

        const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
        const patchPath = await patchStore.saveSelected(stepsCompleted, diffContent);
        if (attempt === 1) patchPaths.push(patchPath);

        const result = await executionService.applyPatch(diffContent, step);

        if (result.success) {
          success = true;
          if (result.filesChanged) {
            result.filesChanged.forEach((f) => touchedFiles.add(f));
          }
          consecutiveApplyFailures = 0;
          lastApplyErrorHash = '';
        } else {
          lastError = result.error || 'Unknown apply error';
          const errorHash = createHash('sha256').update(lastError).digest('hex');
          if (lastApplyErrorHash === errorHash) {
            consecutiveApplyFailures++;
          } else {
            consecutiveApplyFailures = 1;
            lastApplyErrorHash = errorHash;
          }

          if (consecutiveApplyFailures >= 2) {
            return finish(
              'failure',
              'repeated_failure',
              `Repeated patch apply failure: ${lastError}`,
            );
          }
        }
      }

      if (success) {
        stepsCompleted++;
        await eventBus.emit({
          type: 'StepFinished',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: { step, success: true },
        });
      } else {
        await eventBus.emit({
          type: 'StepFinished',
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          runId,
          payload: { step, success: false, error: lastError },
        });

        return finish(
          'failure',
          'repeated_failure',
          `Step failed after retries: ${step}. Error: ${lastError}`,
        );
      }
    }

    return finish('success', undefined, `L1 Plan Executed Successfully. ${stepsCompleted} steps.`);
  }
}
