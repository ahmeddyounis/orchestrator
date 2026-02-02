import { Command } from 'commander';
import path from 'node:path';
import {
  createMemoryStore,
  MemoryEntry,
  type MemoryEntryType,
  type MemoryHit,
  MemorySearchService,
  VectorBackendFactory,
  NoopVectorMemoryBackend,
  type VectorMemoryBackend,
  type MemoryStore,
} from '@orchestrator/memory';
import { ConfigLoader } from '@orchestrator/core';
import { findRepoRoot } from '@orchestrator/repo';
import { createEmbedder } from '@orchestrator/adapters';
import type { Config } from '@orchestrator/shared';

function resolveRepoPath(repoRoot: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(repoRoot, p);
}

function getRepoId(repoRoot: string): string {
  // Core uses repoRoot as repoId today; keep CLI consistent.
  return repoRoot;
}

async function openStore(): Promise<{
  store: MemoryStore;
  config: Config;
  repoRoot: string;
  repoId: string;
}> {
  const repoRoot = await findRepoRoot();
  const config = ConfigLoader.load({ cwd: repoRoot });

  if (!config.memory.enabled) {
    console.error('Memory is not enabled in the configuration.');
    process.exit(1);
  }

  const dbPath = resolveRepoPath(repoRoot, config.memory.storage.path);
  const keyEnvVar = config.security?.encryption?.keyEnv ?? 'ORCHESTRATOR_ENC_KEY';
  const key = process.env[keyEnvVar] ?? '';

  const store = createMemoryStore();
  store.init({
    dbPath,
    encryption: {
      encryptAtRest: config.memory.storage.encryptAtRest ?? false,
      key,
    },
  });

  return { store, config, repoRoot, repoId: getRepoId(repoRoot) };
}

function createVectorBackend(config: Config, repoRoot: string): VectorMemoryBackend {
  const v = config.memory.vector;
  if (!v.enabled) {
    return new NoopVectorMemoryBackend();
  }

  if (v.backend === 'sqlite') {
    return VectorBackendFactory.fromConfig(
      {
        backend: 'sqlite',
        path: path.join(repoRoot, '.orchestrator', 'memory_vectors.sqlite'),
      },
      v.remoteOptIn,
    );
  }

  if (v.backend === 'qdrant') {
    if (!v.qdrant) {
      throw new Error('memory.vector.qdrant is required when backend is qdrant.');
    }
    return VectorBackendFactory.fromConfig(
      {
        backend: 'qdrant',
        url: v.qdrant.url,
        apiKeyEnv: v.qdrant.apiKeyEnv,
        collection: v.qdrant.collection,
      } as unknown as Parameters<typeof VectorBackendFactory.fromConfig>[0],
      v.remoteOptIn,
    );
  }

  return VectorBackendFactory.fromConfig({ backend: v.backend }, v.remoteOptIn);
}

async function status(options: { json?: boolean }) {
  const { store, config, repoRoot, repoId } = await openStore();
  try {
    const status = store.status(repoId);
    const retrievalMode = config.memory.retrieval.mode;

    type VectorStatus =
      | { enabled: false }
      | {
          enabled: true;
          backend: string;
          dims: number;
          embedder: Config['memory']['vector']['embedder'];
          location: string;
          entriesWithVectors: number;
          entriesMissingVectors: number;
        };

    let vectorStatus: VectorStatus = { enabled: false };
    if (config.memory.vector.enabled) {
      const missing = store.listEntriesWithoutVectors(repoId).length;
      const entriesWithVectors = Math.max(0, status.entryCounts.total - missing);

      const vectorBackend = createVectorBackend(config, repoRoot);
      await vectorBackend.init({});
      const info = await vectorBackend.info({});
      vectorStatus = {
        enabled: true,
        backend: info.backend,
        dims: info.dims,
        embedder: config.memory.vector.embedder,
        location: info.location,
        entriesWithVectors,
        entriesMissingVectors: missing,
      };
      await vectorBackend.close?.();
    }

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            enabled: true,
            dbPath: resolveRepoPath(repoRoot, config.memory.storage.path),
            retrievalMode,
            ...status,
            vector: vectorStatus,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log('Memory Status');
    console.log(`  Enabled: true`);
    console.log(`  Retrieval Mode: ${retrievalMode}`);
    console.log(`  Database Path: ${resolveRepoPath(repoRoot, config.memory.storage.path)}`);
    console.log('  Entry Counts (SQL):');
    console.log(`    Procedural: ${status.entryCounts.procedural}`);
    console.log(`    Episodic: ${status.entryCounts.episodic}`);
    console.log(`    Semantic: ${status.entryCounts.semantic}`);
    console.log(`    Total: ${status.entryCounts.total}`);
    console.log(`    Stale: ${status.staleCount}`);
    console.log(
      `  Last Updated: ${
        status.lastUpdatedAt ? new Date(status.lastUpdatedAt).toISOString() : 'Never'
      }`,
    );

    console.log('  Vector Memory:');
    if (vectorStatus.enabled) {
      console.log(`    Enabled: true`);
      console.log(`    Backend: ${vectorStatus.backend}`);
      console.log(`    Dimensions: ${vectorStatus.dims}`);
      console.log(
        `    Embedder: ${vectorStatus.embedder.provider} (dims=${vectorStatus.embedder.dims}${
          vectorStatus.embedder.model ? `, model=${vectorStatus.embedder.model}` : ''
        })`,
      );
      console.log(`    Location: ${vectorStatus.location}`);
      console.log(`    Entries With Vectors: ${vectorStatus.entriesWithVectors}`);
      console.log(`    Entries Missing Vectors: ${vectorStatus.entriesMissingVectors}`);
    } else {
      console.log(`    Enabled: false`);
    }
  } finally {
    store.close();
  }
}

async function list(options: {
  type?: MemoryEntryType;
  limit?: number;
  json?: boolean;
  staleOnly?: boolean;
}) {
  const { store, repoId } = await openStore();
  try {
    let entries = store.list(repoId, options.type, options.limit);

    if (options.staleOnly) {
      entries = entries.filter((entry) => entry.stale);
    }

    if (options.json) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }

    console.log('Memory Entries:');
    entries.forEach((entry: MemoryEntry) => {
      const staleMarker = entry.stale ? ' (stale)' : '';
      console.log(
        `  - [${entry.type}] ${entry.id}: ${entry.title} (updated: ${new Date(
          entry.updatedAt,
        ).toISOString()})${staleMarker}`,
      );
    });
  } finally {
    store.close();
  }
}

async function show(id: string, options: { json?: boolean }) {
  const { store } = await openStore();
  try {
    const entry = store.get(id);

    if (!entry) {
      console.error(`Memory entry with id "${id}" not found.`);
      process.exit(1);
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(entry, null, 2));
      return;
    }

    console.log(`ID: ${entry.id}`);
    console.log(`Type: ${entry.type}`);
    console.log(`Title: ${entry.title}`);
    console.log(`Repo ID: ${entry.repoId}`);
    console.log(`Created At: ${new Date(entry.createdAt).toISOString()}`);
    console.log(`Updated At: ${new Date(entry.updatedAt).toISOString()}`);
    console.log(`Stale: ${entry.stale}`);
    console.log(`Git SHA: ${entry.gitSha || 'N/A'}`);
    if (entry.fileRefsJson) {
      const fileRefs = JSON.parse(entry.fileRefsJson) as string[];
      if (fileRefs.length > 0) {
        console.log('File Refs:');
        fileRefs.forEach((ref) => console.log(`  - ${ref}`));
      }
    }
    console.log(`Content:\n${entry.content}`);
    if (entry.evidenceJson) {
      console.log(`Evidence:\n${JSON.stringify(JSON.parse(entry.evidenceJson), null, 2)}`);
    }
  } finally {
    store.close();
  }
}

async function wipe(options: { yes?: boolean }) {
  const { store, config, repoRoot, repoId } = await openStore();
  try {
    if (!options.yes) {
      const inquirer = await import('inquirer');
      const { confirm } = await inquirer.default.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Are you sure you want to wipe all memory entries for this repository?',
          default: false,
        },
      ]);
      if (!confirm) {
        console.log('Operation cancelled.');
        return;
      }
    }

    const status = store.status(repoId);
    store.wipe(repoId);
    console.log(`Wiped ${status.entryCounts.total} memory entries.`);

    if (config.memory.vector.enabled) {
      const vectorBackend = createVectorBackend(config, repoRoot);
      await vectorBackend.init({});
      await vectorBackend.wipeRepo({}, repoId);
      await vectorBackend.close?.();
      console.log(`Wiped vector backend entries for repo.`);
    }

    console.log('Memory wipe complete for the current repository.');
  } finally {
    store.close();
  }
}

async function reembed(options: {
  limit?: number;
  type?: MemoryEntryType | 'all';
  forceAll?: boolean;
  dryRun?: boolean;
}) {
  const { store, config, repoRoot, repoId } = await openStore();
  try {
    if (!config.memory.vector.enabled) {
      console.error('Vector memory is not enabled in the configuration.');
      process.exit(1);
    }

    const type: MemoryEntryType | undefined = options.type === 'all' ? undefined : options.type;
    const entries = options.forceAll
      ? store.list(repoId, type)
      : store.listEntriesWithoutVectors(repoId, type, options.limit);

    const limit = options.limit ?? entries.length;
    const entriesToProcess = entries.slice(0, limit);

    if (options.dryRun) {
      console.log(`[Dry Run] Found ${entriesToProcess.length} entries that would be re-embedded.`);
      return;
    }

    let embedder;
    try {
      embedder = createEmbedder(config.memory.vector.embedder);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to create embedder: ${message}`);
      process.exit(2);
    }

    const vectorBackend = createVectorBackend(config, repoRoot);
    await vectorBackend.init({});

    console.log(`Found ${entriesToProcess.length} entries to re-embed.`);
    let processed = 0;

    const MAX_EMBED_CONTENT_LENGTH = 4 * 1024; // 4KB
    for (const entry of entriesToProcess) {
      const textToEmbed = entry.title + '\n' + entry.content.substring(0, MAX_EMBED_CONTENT_LENGTH);
      const vectors = await embedder.embedTexts([textToEmbed]);
      if (vectors.length > 0) {
        await vectorBackend.upsert({}, repoId, [
          {
            id: entry.id,
            vector: new Float32Array(vectors[0]),
            metadata: {
              type: entry.type,
              stale: entry.stale ?? false,
              updatedAt: Date.now(),
              embedderId: embedder.id(),
              dims: embedder.dims(),
            },
          },
        ]);
        store.markVectorUpdated(entry.id);
      }
      processed++;

      if (processed % 10 === 0 || processed === entriesToProcess.length) {
        process.stdout.write(`Embedded ${processed}/${entriesToProcess.length} entries...\n`);
      }
    }

    await vectorBackend.close?.();
  } finally {
    store.close();
  }
}

function hitScore(hit: MemoryHit): number {
  if ('combinedScore' in hit) return hit.combinedScore;
  if ('vectorScore' in hit) return hit.vectorScore;
  if ('lexicalScore' in hit) return hit.lexicalScore;
  return 0;
}

async function search(
  query: string,
  options: {
    mode?: 'lexical' | 'vector' | 'hybrid';
    topk?: number;
    json?: boolean;
  },
) {
  const { store, config, repoRoot, repoId } = await openStore();
  try {
    const mode = options.mode ?? config.memory.retrieval.mode ?? 'lexical';
    const topKFinal = options.topk ?? 5;

    let hits: MemoryHit[] = [];

    if (mode === 'lexical') {
      hits = store.search(repoId, query, { topK: topKFinal });
    } else {
      if (!config.memory.vector.enabled) {
        console.error('Vector memory is not enabled.');
        process.exit(1);
      }

      const embedder = createEmbedder(config.memory.vector.embedder);
      const vectorBackend = createVectorBackend(config, repoRoot);
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
        topKLexical: topKFinal,
        topKVector: topKFinal,
        staleDownrank: config.memory.retrieval.staleDownrank,
        fallbackToLexicalOnVectorError: config.memory.retrieval.fallbackToLexicalOnVectorError,
        intent: 'implementation',
      });

      hits = result.hits;
      await vectorBackend.close?.();
    }

    hits.sort((a, b) => hitScore(b) - hitScore(a));
    hits = hits.slice(0, topKFinal);

    if (options.json) {
      console.log(JSON.stringify(hits, null, 2));
      return;
    }

    console.log(`Found ${hits.length} results for "${query}" (mode: ${mode}):`);
    hits.forEach((hit) => {
      const score = hitScore(hit).toFixed(4);
      console.log(`  - [${hit.type}] ${hit.title} (score: ${score})`);
      console.log(`    ${hit.content.substring(0, 200).replace(/\n/g, ' ')}...`);
    });
  } finally {
    store.close();
  }
}

export function registerMemoryCommand(program: Command) {
  const memoryCommand = program.command('memory').description('Manage orchestrator memory.');

  memoryCommand
    .command('status')
    .description('Show memory status.')
    .option('--json', 'Output as JSON.')
    .action(status);

  memoryCommand
    .command('list')
    .description('List memory entries.')
    .option('--type <type>', 'Filter by type (procedural, episodic, semantic).')
    .option('--limit <n>', 'Limit number of results.', parseInt)
    .option('--stale-only', 'Only show stale entries.')
    .option('--json', 'Output as JSON.')
    .action(list);

  memoryCommand
    .command('show <id>')
    .description('Show a specific memory entry.')
    .option('--json', 'Output as JSON.')
    .action(show);

  memoryCommand
    .command('wipe')
    .description('Wipe all memory for the current repository.')
    .option('--yes', 'Skip confirmation prompt.')
    .action(wipe);

  memoryCommand
    .command('reembed')
    .description('Re-embed memory entries.')
    .option('--limit <n>', 'Limit number of entries to re-embed.', parseInt)
    .option(
      '--type <type>',
      'Filter by type (procedural, episodic, semantic, all). Default: all.',
      'all',
    )
    .option('--force-all', 'Re-embed all entries, even those with existing vectors.')
    .option('--dry-run', 'Show how many entries would be re-embedded without actually doing it.')
    .action(reembed);

  memoryCommand
    .command('search <query>')
    .description('Search memory entries.')
    .option('--mode <mode>', 'Search mode (lexical, vector, hybrid).')
    .option('--topk <n>', 'Limit number of results.', parseInt)
    .option('--json', 'Output as JSON.')
    .action(search);
}
