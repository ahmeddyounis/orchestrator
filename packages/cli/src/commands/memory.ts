import { Command } from 'commander';
import {
  createMemoryStore,
  MemoryEntry,
  createVectorMemoryBackend,
  VectorMemoryBackend,
} from '@orchestrator/memory';
import { ConfigLoader } from '@orchestrator/core';
import { findRepoRoot } from '@orchestrator/repo';
import { createEmbedder, Embedder } from '@orchestrator/adapters';

function getMemoryStore() {
  const config = ConfigLoader.load({});
  if (!config.memory?.enabled) {
    console.error('Memory is not enabled in the configuration.');
    process.exit(1);
  }
  const store = createMemoryStore();
  // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
  store.init(config.memory?.storage.path!);
  return store;
}

async function status(options: { json?: boolean }) {
  const store = getMemoryStore();
  const repoId = await findRepoRoot();
  const status = store.status(repoId);
  const config = ConfigLoader.load({});

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          enabled: true,
          dbPath: config.memory?.storage.path,
          ...status,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('Memory Status');
  console.log(`  Enabled: true`);
  console.log(`  Database Path: ${config.memory?.storage.path}`);
  console.log('  Entry Counts:');
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
}

async function list(options: {
  type?: 'procedural' | 'episodic' | 'semantic';
  limit?: number;
  json?: boolean;
  staleOnly?: boolean;
}) {
  const store = getMemoryStore();
  const repoId = await findRepoRoot();
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
}

async function show(id: string, options: { json?: boolean }) {
  const store = getMemoryStore();
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
}

async function wipe(options: { yes?: boolean }) {
  const store = getMemoryStore();
  const repoId = await findRepoRoot();

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

  store.wipe(repoId);
  console.log('Memory wiped for the current repository.');
}

async function reembed(options: {
  limit?: number;
  type?: 'procedural' | 'episodic' | 'all';
  forceAll?: boolean;
}) {
  const config = ConfigLoader.load({});
  const repoId = await findRepoRoot();

  if (!config.memory?.enabled || !config.memory.vector?.enabled) {
    console.error('Vector memory is not enabled in the configuration.');
    process.exit(1);
  }

  const vectorConfig = config.memory.vector;

  // 1. Create Embedder
  const embedderId = vectorConfig.embedder;
  if (!embedderId) {
    console.error('Embedder not configured for vector memory.');
    process.exit(2);
  }

  let embedder: Embedder;
  try {
    embedder = createEmbedder({
      provider: embedderId,
      ...config.embeddings?.[embedderId],
    });
  } catch (e: any) {
    console.error(`Failed to create embedder: ${e.message}`);
    process.exit(2);
  }

  // 2. Create Vector Memory Backend
  const vectorBackend: VectorMemoryBackend = createVectorMemoryBackend(
    config.memory.vector.storage,
  );

  // 3. Get Memory Store
  const store = getMemoryStore();
  const type = options.type === 'all' ? undefined : options.type;

  const memoryEntries = options.forceAll
    ? store.list(repoId, type)
    : store.listEntriesWithoutVectors(repoId, type);

  // 4. Re-embed
  console.log(`Found ${memoryEntries.length} entries to re-embed.`);
  let processed = 0;
  const limit = options.limit || memoryEntries.length;

  const MAX_EMBED_CONTENT_LENGTH = 4 * 1024; // 4KB

  for (const entry of memoryEntries) {
    if (processed >= limit) {
      break;
    }

    process.stdout.write(`Embedding entry ${processed + 1}/${limit}: ${entry.id}\r`);

    const textToEmbed =
      entry.title + '\n' + entry.content.substring(0, MAX_EMBED_CONTENT_LENGTH);
    const vectors = await embedder.embedTexts([textToEmbed]);

    if (vectors.length > 0) {
      await vectorBackend.upsert(repoId, [
        { id: entry.id, vector: vectors[0], metadata: { type: entry.type } },
      ]);
      store.markVectorUpdated(entry.id);
    }
    processed++;
  }

  console.log(`\nSuccessfully re-embedded ${processed} memory entries.`);
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
    .option('--type <type>', 'Filter by type (procedural, episodic, all). Default to all.', 'all')
    .option('--force-all', 'Re-embed all entries, even those with existing vectors.')
    .action(reembed);
}
