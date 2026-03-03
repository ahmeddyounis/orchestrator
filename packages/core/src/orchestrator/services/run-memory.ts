import { createMemoryStore, MemoryEntry, MemorySearchService } from '@orchestrator/memory';
import { Config, ConfigError, RetrievalIntent, RunSummary } from '@orchestrator/shared';
import type { GitService } from '@orchestrator/repo';
import { NoopVectorMemoryBackend, VectorBackendFactory } from '@orchestrator/memory';
import { createEmbedder } from '@orchestrator/adapters';
import type { EventBus } from '../../registry';
import type { RepoState } from '../../memory/types';
import type { VerificationReport } from '../../verify/types';
import { MemoryWriter } from '../../memory';
import path from 'path';
import fs from 'fs/promises';
import * as fsSync from 'fs';

export class RunMemoryService {
  constructor(
    private readonly config: Config,
    private readonly repoRoot: string,
    private readonly git: GitService,
  ) {}

  private shouldWriteEpisodicMemory(): boolean {
    const mem = this.config.memory;
    return !!(mem?.enabled && mem?.writePolicy?.enabled && mem?.writePolicy?.storeEpisodes);
  }

  resolveMemoryDbPath(): string | undefined {
    const p = this.config.memory?.storage?.path;
    if (!p) return undefined;
    return path.isAbsolute(p) ? p : path.join(this.repoRoot, p);
  }

  private toArtifactRelPath(p: string): string {
    if (!path.isAbsolute(p)) return p;
    const prefix = this.repoRoot.endsWith(path.sep) ? this.repoRoot : this.repoRoot + path.sep;
    if (!p.startsWith(prefix)) return p;
    return path.relative(this.repoRoot, p);
  }

  private collectArtifactPaths(
    artifactsRoot: string,
    patchPaths: string[] = [],
    extraPaths: string[] = [],
  ): string[] {
    const absPaths: string[] = [];
    const add = (p?: string) => {
      if (!p) return;
      absPaths.push(p);
    };

    add(path.join(artifactsRoot, 'trace.jsonl'));
    add(path.join(artifactsRoot, 'summary.json'));
    add(path.join(artifactsRoot, 'manifest.json'));
    add(path.join(artifactsRoot, 'effective-config.json'));

    for (const p of patchPaths) add(p);
    for (const p of extraPaths) add(p);

    // Include any key run outputs and reports, plus patch/log artifacts.
    const root = artifactsRoot;
    const patchesDir = path.join(root, 'patches');
    const toolLogsDir = path.join(root, 'tool_logs');
    const verificationDir = path.join(root, 'verification');
    const selectionDir = path.join(root, 'selection');

    const addDirFiles = (dir: string, filter?: (name: string) => boolean) => {
      if (!fsSync.existsSync(dir)) return;
      for (const name of fsSync.readdirSync(dir)) {
        if (filter && !filter(name)) continue;
        const full = path.join(dir, name);
        try {
          if (fsSync.statSync(full).isFile()) add(full);
        } catch {
          /* ignore */
        }
      }
    };

    addDirFiles(patchesDir, (n) => n.endsWith('.patch'));
    addDirFiles(toolLogsDir);
    addDirFiles(verificationDir, (n) => n.endsWith('.json') || n.endsWith('.txt'));
    addDirFiles(selectionDir, (n) => n.endsWith('.json'));

    addDirFiles(
      root,
      (n) =>
        n === 'executor_output.txt' ||
        /^step_.*_output\.txt$/.test(n) ||
        /^repair_iter_\d+_output\.txt$/.test(n) ||
        /^verification_report_.*\.json$/.test(n) ||
        /^verification_command_source.json$/.test(n) ||
        /^verification_summary_.*\.txt$/.test(n) ||
        /^failure_summary_iter_\d+\.(json|txt)$/.test(n) ||
        /^fused_context_.*\.(json|txt)$/.test(n) ||
        /^reviewer_iter_.*\.json$/.test(n),
    );

    // De-dupe + relativize.
    return [...new Set(absPaths.map((p) => this.toArtifactRelPath(p)))];
  }

  async writeEpisodicMemory(
    summary: RunSummary,
    args: {
      artifactsRoot: string;
      patchPaths?: string[];
      extraArtifactPaths?: string[];
      verificationReport?: VerificationReport;
    },
    options?: {
      eventBus?: EventBus;
      suppress?: boolean;
    },
  ): Promise<void> {
    if (options?.suppress) return;
    if (!this.shouldWriteEpisodicMemory()) return;

    let gitSha = '';
    try {
      gitSha = await this.git.getHeadSha();
    } catch {
      gitSha = 'unknown';
    }

    const repoState: RepoState = {
      gitSha,
      repoId: this.repoRoot,
      memoryDbPath: this.resolveMemoryDbPath(),
      config: this.config,
      artifactPaths: this.collectArtifactPaths(
        args.artifactsRoot,
        args.patchPaths ?? [],
        args.extraArtifactPaths ?? [],
      ),
    };

    try {
      const writer = new MemoryWriter({
        eventBus: options?.eventBus,
        runId: summary.runId,
        securityConfig: this.config.security,
      });
      await writer.extractEpisodic(
        {
          runId: summary.runId,
          goal: summary.goal ?? '',
          status: summary.status,
          stopReason: summary.stopReason ?? 'unknown',
        },
        repoState,
        args.verificationReport,
      );
    } catch {
      // Non-fatal: don't fail the run if memory persistence fails.
    }
  }

  async searchMemoryHits(
    args: {
      query: string;
      runId: string;
      stepId: number;
      artifactsRoot: string;
      intent: RetrievalIntent;
      failureSignature?: string;
    },
    eventBus: EventBus,
  ): Promise<MemoryEntry[]> {
    const memConfig = this.config.memory;
    if (!memConfig?.enabled) {
      return [];
    }

    const dbPath = this.resolveMemoryDbPath();
    if (!dbPath) {
      return [];
    }

    const store = createMemoryStore();
    let vectorBackend: ReturnType<typeof VectorBackendFactory.fromConfig> | undefined;
    try {
      const keyEnvVar = this.config.security?.encryption?.keyEnv ?? 'ORCHESTRATOR_ENC_KEY';
      const key = process.env[keyEnvVar];

      store.init({
        dbPath,
        encryption: {
          encryptAtRest: memConfig.storage?.encryptAtRest ?? false,
          key: key || '',
        },
      });

      const { query } = args;
      const retrieval = memConfig.retrieval;
      const mode = retrieval.mode;
      const topKLexical = retrieval.topKLexical ?? 8;
      const topKVector = retrieval.topKVector ?? 8;
      const topKFinal = Math.max(topKLexical, topKVector);

      const repoId = this.repoRoot;

      let hitsForArtifact: unknown[] = [];
      let entries: MemoryEntry[] = [];

      if (mode === 'lexical') {
        const lexicalHits = store
          .search(repoId, query, { topK: topKFinal })
          .filter((hit) => hit.integrityStatus !== 'blocked');
        hitsForArtifact = lexicalHits;
        entries = lexicalHits
          .map((hit) => store.get(hit.id))
          .filter((entry): entry is MemoryEntry => !!entry && entry.integrityStatus !== 'blocked');
      } else {
        if (!memConfig.vector.enabled) {
          vectorBackend = new NoopVectorMemoryBackend();
        } else if (memConfig.vector.backend === 'sqlite') {
          vectorBackend = VectorBackendFactory.fromConfig(
            {
              backend: 'sqlite',
              path: path.join(this.repoRoot, '.orchestrator/memory_vectors.sqlite'),
            },
            memConfig.vector.remoteOptIn,
          );
        } else if (memConfig.vector.backend === 'qdrant') {
          const qdrant = memConfig.vector.qdrant;
          if (!qdrant) {
            throw new ConfigError('`memory.vector.qdrant` is required when backend is qdrant.');
          }
          vectorBackend = VectorBackendFactory.fromConfig(
            {
              backend: 'qdrant',
              url: qdrant.url,
              apiKeyEnv: qdrant.apiKeyEnv,
              collection: qdrant.collection,
            } as unknown as Parameters<typeof VectorBackendFactory.fromConfig>[0],
            memConfig.vector.remoteOptIn,
          );
        } else {
          vectorBackend = VectorBackendFactory.fromConfig(
            { backend: memConfig.vector.backend },
            memConfig.vector.remoteOptIn,
          );
        }

        const embedder = createEmbedder(memConfig.vector.embedder);
        await vectorBackend.init({});

        const searchService = new MemorySearchService({
          memoryStore: store,
          vectorBackend,
          embedder,
          repoId,
        });

        const result = await searchService.search({
          query,
          mode,
          topKFinal,
          topKLexical,
          topKVector,
          intent: args.intent,
          staleDownrank: retrieval.staleDownrank,
          episodicBoostFailureSignature: args.failureSignature,
          fallbackToLexicalOnVectorError: retrieval.fallbackToLexicalOnVectorError,
        });

        hitsForArtifact = result.hits;
        entries = result.hits
          .map((hit) => store.get(hit.id))
          .filter((entry): entry is MemoryEntry => !!entry && entry.integrityStatus !== 'blocked');
      }

      await eventBus.emit({
        type: 'MemorySearched',
        schemaVersion: 1,
        runId: args.runId,
        timestamp: new Date().toISOString(),
        payload: {
          query,
          topK: topKFinal,
          hitsCount: entries.length,
          intent: args.intent,
        },
      });

      if (hitsForArtifact.length === 0) {
        return [];
      }

      const artifactPath = path.join(args.artifactsRoot, `memory_hits_step_${args.stepId}.json`);
      await fs.writeFile(artifactPath, JSON.stringify(hitsForArtifact, null, 2));

      return entries;
    } catch (err) {
      // Log but don't fail
      console.error('Memory search failed:', err);
      return [];
    } finally {
      store.close();
      await vectorBackend?.close?.();
    }
  }
}
