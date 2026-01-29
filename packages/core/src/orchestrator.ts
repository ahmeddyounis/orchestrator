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
  PatchApplier
} from '@orchestrator/repo';
import { ProviderRegistry } from './registry';
import { PatchStore } from './exec/patch_store';
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
      type: 'WorkflowStarted',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: { goal, thinkLevel: 'L0' }
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
      // Spec says "limited search on goal keywords". 
      // SearchService supports regex by default in `ripgrep`.
      
      // Let's search for the first 3 significant terms.
      const terms = keywords.slice(0, 3);
      if (terms.length > 0) {
        // We do sequential searches for now to gather some context
        // Or construct a regex: (term1|term2|term3)
        const regex = `(${terms.join('|')})`;
        try {
          const results = await searchService.search({
            query: regex,
            regex: true,
            maxMatchesPerFile: 3,
            maxTotalMatches: 20
          });
          
          searchResults = results.matches.map(m => 
            `${m.path}:${m.line} ${m.matchText.trim()}`
          ).join('\n');
        } catch {
          // Ignore search errors
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
    const executor = await this.registry.getProvider(
      this.config.defaults?.executor || 'openai', // Fallback or throw?
      'executor'
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
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Implement the goal.' }]
    });

    const outputText = response.text;
    
    // Write raw output artifact
    await fs.writeFile(path.join(artifacts.root, 'executor_output.txt'), outputText);

    // 4. Parse Diff
    const diffMatch = outputText.match(/BEGIN_DIFF([\s\S]*?)END_DIFF/);
    
    if (!diffMatch || !diffMatch[1].trim()) {
        const msg = 'Failed to extract diff from executor output';
        await emitEvent({
            type: 'WorkflowFailed',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: { error: msg }
        });
        throw new Error(msg);
    }

    const diffContent = diffMatch[1].trim();

    // 5. Apply Patch
    const patchStore = new PatchStore(artifacts.patchesDir, artifacts.manifest);
    await patchStore.saveSelected(0, diffContent);
    await patchStore.saveFinalDiff(diffContent); // Assuming single pass is final

    await emitEvent({
        type: 'PatchProposed',
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId,
        payload: {
            diff: diffContent,
            files: [] // We could parse this, but for L0 let's keep it simple or use applier result
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
            type: 'WorkflowCompleted',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: { 
                result: 'Patch applied successfully',
                filesChanged: result.filesChanged 
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
            type: 'WorkflowFailed',
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            runId,
            payload: { error: 'Patch application failed' }
        });
    }

    // Write manifest
     await writeManifest(artifacts.manifest, {
          runId,
          startedAt: new Date().toISOString(), // Should be captured at start
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
}