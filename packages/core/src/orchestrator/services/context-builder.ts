import {
  SearchService,
  SnippetExtractor,
  SimpleContextPacker,
  ContextSignal,
  SemanticIndexStore,
  SemanticSearchService,
  type SemanticHit,
} from '@orchestrator/repo';
import type { Config } from '@orchestrator/shared';
import type { ContextStackFrame } from '@orchestrator/shared';
import type { EventBus } from '../../registry';
import { SimpleContextFuser } from '../../context';
import type { FusedContext } from '../../context';
import type { MemoryEntry } from '@orchestrator/memory';
import { createEmbedder } from '@orchestrator/adapters';
import path from 'path';
import fs from 'fs/promises';
import * as fsSync from 'fs';

export interface ContextBuildResult {
  fusedContext: FusedContext;
  contextPack?: ReturnType<SimpleContextPacker['pack']>;
  contextPaths: string[];
}

export interface ContextFusionBudgets {
  maxRepoContextChars: number;
  maxMemoryChars: number;
  maxSignalsChars: number;
  maxContextStackChars: number;
  maxContextStackFrames: number;
}

/**
 * Service for building context from repo, memory, and signals
 */
export class ContextBuilderService {
  constructor(
    private readonly config: Config,
    private readonly repoRoot: string,
  ) {}

  fuseContext(options: {
    goalText: string;
    contextPack?: ReturnType<SimpleContextPacker['pack']>;
    memoryHits: MemoryEntry[];
    signals: ContextSignal[];
    contextStack?: ContextStackFrame[];
    budgets?: Partial<ContextFusionBudgets>;
  }): FusedContext {
    const fuser = new SimpleContextFuser(this.config.security);

    const stackEnabled = this.config.contextStack?.enabled ?? false;
    const fusionBudgets: ContextFusionBudgets = {
      maxRepoContextChars: (this.config.context?.tokenBudget || 8000) * 4,
      maxMemoryChars: this.config.memory?.maxChars ?? 2000,
      maxSignalsChars: 1000,
      maxContextStackChars: stackEnabled ? this.config.contextStack.promptBudgetChars : 0,
      maxContextStackFrames: stackEnabled ? this.config.contextStack.promptMaxFrames : 0,
    };
    const mergedBudgets = { ...fusionBudgets, ...(options.budgets ?? {}) };

    return fuser.fuse({
      goal: options.goalText,
      repoPack: options.contextPack ?? { items: [], totalChars: 0, estimatedTokens: 0 },
      memoryHits: options.memoryHits,
      signals: options.signals,
      contextStack: options.contextStack,
      budgets: mergedBudgets,
    });
  }

  private async measure<T>(
    name: string,
    eventBus: EventBus,
    runId: string,
    fn: () => T | Promise<T>,
    metadataFn?: (result: T) => Record<string, unknown>,
  ): Promise<T> {
    const start = Date.now();
    const result = await fn();
    const durationMs = Date.now() - start;
    await eventBus.emit({
      type: 'PerformanceMeasured',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId,
      payload: {
        name,
        durationMs,
        metadata: metadataFn ? metadataFn(result) : undefined,
      },
    });
    return result;
  }

  private async semanticSearch(options: {
    query: string;
    eventBus: EventBus;
    runId: string;
    artifactsRoot: string;
    stepIndex: number;
  }): Promise<{
    hits: SemanticHit[];
    matches: Array<{ path: string; line: number; score: number }>;
  }> {
    const semanticConfig = this.config.indexing?.semantic;
    if (!semanticConfig?.enabled) return { hits: [], matches: [] };

    let store: SemanticIndexStore | undefined;
    try {
      const semanticDbPath = path.isAbsolute(semanticConfig.storage.path)
        ? semanticConfig.storage.path
        : path.join(this.repoRoot, semanticConfig.storage.path);

      if (!fsSync.existsSync(semanticDbPath)) {
        return { hits: [], matches: [] };
      }

      store = new SemanticIndexStore();
      store.init(semanticDbPath);

      const embedder = createEmbedder(semanticConfig.embeddings);

      const meta = store.getMeta();
      if (meta?.embedderId && meta.embedderId !== embedder.id()) {
        console.warn(
          `Semantic index embedder mismatch: index=${meta.embedderId} config=${embedder.id()}. Results may be degraded.`,
        );
      }

      const semanticSearchService = new SemanticSearchService({
        store,
        embedder,
        eventBus: options.eventBus,
      });

      const topK = 5;
      const hits = await this.measure(
        'semantic_search',
        options.eventBus,
        options.runId,
        () => semanticSearchService.search(options.query, topK, options.runId),
        (h) => ({ hitCount: h.length }),
      );

      if (hits.length > 0) {
        const hitsArtifactPath = path.join(
          options.artifactsRoot,
          `semantic_hits_step_${options.stepIndex}.json`,
        );
        await fs.writeFile(hitsArtifactPath, JSON.stringify(hits, null, 2));
      }

      const matches = hits.map((hit) => ({
        path: hit.path,
        line: hit.startLine,
        score: hit.score,
      }));

      return { hits, matches };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await options.eventBus.emit({
        type: 'SemanticSearchFailed',
        schemaVersion: 1,
        runId: options.runId,
        timestamp: new Date().toISOString(),
        payload: {
          error: message,
        },
      });
      return { hits: [], matches: [] };
    } finally {
      store?.close();
    }
  }

  /**
   * Build fused context for a step
   */
  async buildStepContext(options: {
    goal: string;
    goalText?: string;
    step: string;
    query?: string;
    touchedFiles: Set<string>;
    memoryHits: MemoryEntry[];
    signals: ContextSignal[];
    contextStack?: ContextStackFrame[];
    eventBus: EventBus;
    runId: string;
    artifactsRoot: string;
    stepsCompleted: number;
  }): Promise<ContextBuildResult> {
    const {
      goal,
      goalText,
      step,
      touchedFiles,
      memoryHits,
      signals,
      artifactsRoot,
      stepsCompleted,
      contextStack,
    } = options;
    const query = options.query ?? step;
    const goalForFusion = goalText ?? `Goal: ${goal}\nCurrent Step: ${step}`;

    let contextPack: ReturnType<SimpleContextPacker['pack']> | undefined;
    const contextPaths: string[] = [];

    try {
      const searchService = new SearchService(this.config.context?.rgPath);
      const searchResults = await this.measure(
        'lexical_search',
        options.eventBus,
        options.runId,
        () =>
          searchService.search({
            query,
            cwd: this.repoRoot,
            maxMatchesPerFile: 5,
            fixedStrings: true,
          }),
        (r) => ({ matchCount: r.matches.length }),
      );

      const lexicalMatches = searchResults.matches;

      const semantic = await this.semanticSearch({
        query,
        eventBus: options.eventBus,
        runId: options.runId,
        artifactsRoot,
        stepIndex: stepsCompleted,
      });

      if (semantic.hits.length > 0) {
        contextPaths.push(path.join(artifactsRoot, `semantic_hits_step_${stepsCompleted}.json`));
      }

      // Build all matches including touched files
      const allMatches = [
        ...lexicalMatches,
        ...semantic.matches.map((h) => ({
          path: h.path,
          line: h.line,
          column: 0,
          matchText: 'SEMANTIC_MATCH',
          lineText: '',
          score: h.score,
        })),
      ];

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
      const candidates = await this.measure(
        'snippet_extraction',
        options.eventBus,
        options.runId,
        () => extractor.extractSnippets(limitedMatches, { cwd: this.repoRoot }),
        (c) => ({ candidateCount: c.length }),
      );

      const packer = new SimpleContextPacker();
      contextPack = await this.measure(
        'context_packing',
        options.eventBus,
        options.runId,
        () =>
          packer.pack(query, signals, candidates, {
            tokenBudget: this.config.context?.tokenBudget || 8000,
          }),
        (p) => ({ itemCount: p.items.length, estimatedTokens: p.estimatedTokens }),
      );
    } catch {
      // Ignore context errors
    }

    const fusedContext = this.fuseContext({
      goalText: goalForFusion,
      contextPack,
      memoryHits,
      signals,
      contextStack,
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
    contextPaths.push(fusedJsonPath, fusedTxtPath);

    return { fusedContext, contextPack, contextPaths };
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
