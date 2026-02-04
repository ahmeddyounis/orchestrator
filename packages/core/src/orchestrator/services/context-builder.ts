import {
  RepoScanner,
  SearchService,
  SnippetExtractor,
  SimpleContextPacker,
  ContextSignal,
  SemanticIndexStore,
  SemanticSearchService,
} from '@orchestrator/repo';
import { createEmbedder } from '@orchestrator/adapters';
import { Config } from '@orchestrator/shared';
import { EventBus } from '../../registry';
import { SimpleContextFuser, FusedContext } from '../../context';
import { MemoryEntry } from '@orchestrator/memory';
import path from 'path';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';

export interface ContextBuildResult {
  fusedContext: FusedContext;
  contextPack?: ReturnType<SimpleContextPacker['pack']>;
}

/**
 * Service for building context from repo, memory, and signals
 */
export class ContextBuilderService {
  constructor(
    private readonly config: Config,
    private readonly repoRoot: string,
  ) {}

  /**
   * Build fused context for a step
   */
  async buildStepContext(options: {
    goal: string;
    step: string;
    touchedFiles: Set<string>;
    memoryHits: MemoryEntry[];
    signals: ContextSignal[];
    eventBus: EventBus;
    runId: string;
    artifactsRoot: string;
    stepsCompleted: number;
  }): Promise<ContextBuildResult> {
    const { goal, step, touchedFiles, memoryHits, signals, eventBus, runId, artifactsRoot, stepsCompleted } = options;

    let contextPack: ReturnType<SimpleContextPacker['pack']> | undefined;

    try {
      const searchService = new SearchService(this.config.context?.rgPath);
      const searchResults = await searchService.search({
        query: step,
        cwd: this.repoRoot,
        maxMatchesPerFile: 5,
      });

      const lexicalMatches = searchResults.matches;

      // Build all matches including touched files
      const allMatches = [...lexicalMatches];

      for (const touched of touchedFiles) {
        allMatches.push({
          path: touched,
          line: 1,
          column: 1,
          matchText: 'PREVIOUSLY_TOUCHED',
          lineText: '',
          score: 1000,
        });
      }

      allMatches.sort((a, b) => (b.score || 0) - (a.score || 0));
      const limitedMatches = this.config.context?.maxCandidates
        ? allMatches.slice(0, this.config.context.maxCandidates)
        : allMatches;

      const extractor = new SnippetExtractor();
      const candidates = await extractor.extractSnippets(limitedMatches, { cwd: this.repoRoot });

      const packer = new SimpleContextPacker();
      contextPack = packer.pack(step, [], candidates, {
        tokenBudget: this.config.context?.tokenBudget || 8000,
      });
    } catch {
      // Ignore context errors
    }

    const fuser = new SimpleContextFuser(this.config.security);
    const fusionBudgets = {
      maxRepoContextChars: (this.config.context?.tokenBudget || 8000) * 4,
      maxMemoryChars: this.config.memory?.maxChars ?? 2000,
      maxSignalsChars: 1000,
    };

    const fusedContext = fuser.fuse({
      goal: `Goal: ${goal}\nCurrent Step: ${step}`,
      repoPack: contextPack ?? { items: [], totalChars: 0, estimatedTokens: 0 },
      memoryHits,
      signals,
      budgets: fusionBudgets,
    });

    // Save context artifacts
    const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
    const fusedJsonPath = path.join(
      artifactsRoot,
      `fused_context_step_${stepsCompleted}_${stepSlug}.json`,
    );
    const fusedTxtPath = path.join(
      artifactsRoot,
      `fused_context_step_${stepsCompleted}_${stepSlug}.txt`,
    );

    await fs.writeFile(fusedJsonPath, JSON.stringify(fusedContext.metadata, null, 2));
    await fs.writeFile(fusedTxtPath, fusedContext.prompt);

    return { fusedContext, contextPack };
  }

  /**
   * Get the context paths that were saved
   */
  getContextPaths(artifactsRoot: string, stepsCompleted: number, step: string): string[] {
    const stepSlug = step.slice(0, 20).replace(/[^a-z0-9]/gi, '_');
    return [
      path.join(artifactsRoot, `fused_context_step_${stepsCompleted}_${stepSlug}.json`),
      path.join(artifactsRoot, `fused_context_step_${stepsCompleted}_${stepSlug}.txt`),
    ];
  }
}
