
import { Command } from 'commander';
import { createMemoryStore, MemoryEntry } from '@orchestrator/memory';
import { ConfigLoader } from '@orchestrator/core';
import { findRepoRoot } from '@orchestrator/repo';

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
    console.log(JSON.stringify({
      enabled: true,
      dbPath: config.memory?.storage.path,
      ...status,
    }, null, 2));
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
  console.log(
    `  Last Updated: ${ 
      status.lastUpdatedAt ? new Date(status.lastUpdatedAt).toISOString() : 'Never'
    }`,
  );
}

async function list(options: { type?: 'procedural' | 'episodic' | 'semantic', limit?: number, json?: boolean }) {
  const store = getMemoryStore();
  const repoId = await findRepoRoot();
  const entries = store.list(repoId, options.type, options.limit);

  if (options.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log('Memory Entries:');
  entries.forEach((entry: MemoryEntry) => {
    console.log(
      `  - [${entry.type}] ${entry.id}: ${entry.title} (updated: ${new Date(
        entry.updatedAt,
      ).toISOString()})`,
    );
  });
}

async function show(id: string, options: { json?: boolean }) {
  const store = getMemoryStore();
  const entry = store.get(id);

  if (!entry) {
    console.error(`Memory entry with id "${id}" not found.`);
    process.exit(1);
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


export function registerMemoryCommand(program: Command) {
  const memoryCommand = program
    .command('memory')
    .description('Manage orchestrator memory.');

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
}
