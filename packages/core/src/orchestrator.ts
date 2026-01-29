import {
  Config,
  OrchestratorEvent,
  createRunDir,
  writeManifest,
  JsonlLogger
} from '@orchestrator/shared';
import {
  GitService,
  RepoScanner,
  SearchService,
  PatchApplier,
  SimpleContextPacker,
  SnippetExtractor
} from '@orchestrator/repo';
import { ProviderRegistry, EventBus } from './registry';
import { PatchStore } from './exec/patch_store';
import { PlanService } from './plan/service';
import { ExecutionService } from './exec/service';
import path from 'path';
import fs from 'fs/promises';

export interface OrchestratorOptions {
  config: Config;
  git: GitService;
  registry: ProviderRegistry;
  repoRoot: string;
}

export class Orchestrator {
  private config: Config;
  private git: GitService;
  private registry: ProviderRegistry;
  private repoRoot: string;

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.git = options.git;
    this.registry = options.registry;
    this.repoRoot = options.repoRoot;
  }

  async runL0(goal: string, runId: string): Promise<void> {
    // 1. Setup Artifacts
    const artifacts = await createRunDir(this.repoRoot, runId);
    const logger = new JsonlLogger(artifacts.trace);
    
    const emitEvent = async (e: OrchestratorEvent) => {
      await logger.log(e);
    };

    await emitEvent({
      type: 'RunStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { taskId: runId, goal }
    });

    // 2. Build Minimal Context
    const scanner = new RepoScanner();
    const searchService = new SearchService();
    
    // Wire up search events to logger
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    searchService.on('RepoSearchStarted', (_e) => { /* log if needed */ });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    searchService.on('RepoSearchFinished', (_e) => { /* log if needed */ });

    // Scan repo structure
    const snapshot = await scanner.scan(this.repoRoot);
    const fileList = snapshot.files.map(f => f.path).join('\n');

    // Search for keywords (simple tokenization of goal)
    const keywords = goal.split(' ').filter(w => w.length > 3).slice(0, 5);
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
          
          searchResults = results.matches.map(m => 
            `${m.path}:${m.line} ${m.matchText.trim()}`
          ).join('\n');
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
    const executor = this.registry.getAdapter(
      this.config.defaults?.executor || 'openai'
    );

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

    const response = await executor.generate({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Implement the goal.' }
      ]
    }, { runId, logger });

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
            payload: { status: 'failure', summary: msg }
        });
        throw new Error(msg);
    }

    const diffContent = diffMatch[1].trim();

    // 5. Apply Patch
    const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
    await patchStore.saveSelected(0, diffContent);
    await patchStore.saveFinalDiff(diffContent); 

    await emitEvent({
        type: 'PatchProposed',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
            diffPreview: diffContent,
            filePaths: [] 
        }
    });

    const applier = new PatchApplier();
    const result = await applier.applyUnifiedDiff(this.repoRoot, diffContent, {
        maxFilesChanged: this.config.patch?.maxFilesChanged,
        maxLinesTouched: this.config.patch?.maxLinesChanged,
        allowBinary: this.config.patch?.allowBinary
    });

    if (result.applied) {
        await emitEvent({
            type: 'PatchApplied',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: {
                description: 'L0 Auto-applied patch',
                filesChanged: result.filesChanged,
                success: true
            }
        });

        await emitEvent({
            type: 'RunFinished',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: { 
                status: 'success',
                summary: 'Patch applied successfully' 
            }
        });
    } else {
        await emitEvent({
            type: 'PatchApplyFailed',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: {
                error: result.error?.message || 'Unknown error',
                details: result.error?.details
            }
        });
        
         await emitEvent({
            type: 'RunFinished',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: { status: 'failure', summary: 'Patch application failed' }
        });
    }

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
          patchPaths: [path.join(artifacts.patchesDir, 'iter_0_selected.patch')],
          toolLogPaths: [],
        });
  }

  async runL1(goal: string, runId: string): Promise<void> {
    const artifacts = await createRunDir(this.repoRoot, runId);
    const logger = new JsonlLogger(artifacts.trace);
    
    const eventBus: EventBus = {
      emit: async (e) => await logger.log(e)
    };

    await eventBus.emit({
      type: 'RunStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { taskId: runId, goal }
    });

    const plannerId = this.config.defaults?.planner || 'openai';
    const executorId = this.config.defaults?.executor || 'openai';
    const reviewerId = this.config.defaults?.reviewer || 'openai';

    const providers = await this.registry.resolveRoleProviders(
      { plannerId, executorId, reviewerId },
      { eventBus, runId }
    );

    const planService = new PlanService(eventBus);
    
    const context = {
        runId,
        config: this.config,
        logger
    };
    
    const steps = await planService.generatePlan(
        goal, 
        { planner: providers.planner }, 
        context, 
        artifacts.root, 
        this.repoRoot, 
        this.config
    );

    if (steps.length === 0) {
        throw new Error('Planning failed to produce any steps.');
    }

    const executionService = new ExecutionService(
        eventBus,
        this.git,
        new PatchApplier(),
        runId,
        this.repoRoot,
        this.config,
    );

    const maxIterations = 30;
    let stepsCompleted = 0;
    const patchPaths: string[] = [];
    const touchedFiles = new Set<string>();

    for (const step of steps) {
        if (stepsCompleted >= maxIterations) break;

        await eventBus.emit({
            type: 'StepStarted',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: { step, index: stepsCompleted, total: steps.length }
        });

        let contextPack;
        try {
            const scanner = new RepoScanner();
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const snapshot = await scanner.scan(this.repoRoot, {
                excludes: this.config.context?.exclude
            });

            const searchService = new SearchService(this.config.context?.rgPath);
            const searchResults = await searchService.search({
                query: step, 
                cwd: this.repoRoot,
                maxMatchesPerFile: 5
            });

            const extraMatches = [];
            for (const touched of touchedFiles) {
                 extraMatches.push({
                    path: touched,
                    line: 1,
                    column: 1,
                    matchText: 'PREVIOUSLY_TOUCHED',
                    lineText: '',
                    score: 1000 
                });
            }

            const extractor = new SnippetExtractor();
            const candidates = await extractor.extractSnippets(
                [...searchResults.matches, ...extraMatches], 
                { cwd: this.repoRoot }
            );

            const packer = new SimpleContextPacker();
            contextPack = packer.pack(step, [], candidates, { 
                tokenBudget: this.config.context?.tokenBudget || 8000 
            });

        } catch {
             // Ignore context errors
        }

        let contextText = `Goal: ${goal}\nCurrent Step: ${step}\n`;
        if (contextPack) {
             contextText += `\nCONTEXT:\n`;
             for (const item of contextPack.items) {
                contextText += `File: ${item.path}\n\
${item.content}\
\
`;
             }
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

            const response = await providers.executor.generate({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: 'Implement the step.' }
                ]
            }, { runId, logger });

            const outputText = response.text;
            
            if (outputText) {
                                const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
                                await fs.writeFile(
                                    path.join(artifacts.root, `step_${stepsCompleted}_${stepSlug}_attempt_${attempt}_output.txt`), 
                                    outputText
                                );            }

            const diffMatch = outputText?.match(/BEGIN_DIFF([\s\S]*?)END_DIFF/);
            
            if (!diffMatch || !diffMatch[1].trim()) {
                lastError = 'Failed to extract diff from executor output';
                continue;
            }

            const diffContent = diffMatch[1].trim();
            
            const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
            const patchPath = await patchStore.saveSelected(stepsCompleted, diffContent);
            if (attempt === 1) patchPaths.push(patchPath); 

            const result = await executionService.applyPatch(diffContent, step);
            
            if (result.success) {
                success = true;
                if (result.filesChanged) {
                    result.filesChanged.forEach(f => touchedFiles.add(f));
                }
            } else {
                lastError = result.error || 'Unknown apply error';
            }
        }

        if (success) {
            stepsCompleted++;
            await eventBus.emit({
                type: 'StepFinished',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: { step, success: true }
            });
        } else {
             await eventBus.emit({
                type: 'StepFinished',
                schemaVersion: 1,
                timestamp: new Date().toISOString(),
                runId,
                payload: { step, success: false, error: lastError }
            });
            throw new Error(`Step failed after retries: ${step}. Error: ${lastError}`);
        }
    }

    await writeManifest(artifacts.manifest, {
          runId,
          startedAt: new Date().toISOString(),
          command: `run ${goal}`,
          repoRoot: this.repoRoot,
          artifactsDir: artifacts.root,
          tracePath: artifacts.trace,
          summaryPath: artifacts.summary,
          effectiveConfigPath: path.join(artifacts.root, 'effective-config.json'),
          patchPaths: patchPaths, 
          toolLogPaths: [],
    });
    
    await eventBus.emit({
        type: 'RunFinished',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
            status: 'success',
            summary: `L1 Plan Executed Successfully. ${stepsCompleted} steps.`
        }
    });
  }
}
