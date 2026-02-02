import { Command } from 'commander';
import { findRepoRoot, SemanticIndexStore, SemanticSearchService } from '@orchestrator/repo';
import { ConfigLoader, type DeepPartial } from '@orchestrator/core';
import type { Config, EventBus } from '@orchestrator/shared';
import { GlobalOptions } from '../types';
import { createEmbedder } from '@orchestrator/adapters';
import path from 'node:path';

export function registerSearchCommand(program: Command) {
  program
    .command('search <query>')
    .description('Search the repository index')
    .option('--semantic', 'Perform semantic search', false)
    .option('--topk <k>', 'Number of results to return', '5')
    .action(async (query: string, options) => {
      const globalOpts = program!.opts() as GlobalOptions;

      const repoRoot = await findRepoRoot();

      const flags: DeepPartial<Config> = {};
      if (options.semantic) {
        flags.indexing = { semantic: { enabled: true } };
      }

      const config = ConfigLoader.load({
        configPath: globalOpts.config,
        cwd: repoRoot,
        flags,
      });

      if (!options.semantic) {
        // TODO: Implement procedural search
        console.error('Only semantic search is currently supported.');
        process.exit(1);
      }

      const semanticConfig = config.indexing?.semantic;
      if (!semanticConfig?.enabled) {
        console.error(
          'Semantic indexing is not enabled. Please enable it in your config or run `index build --semantic`.',
        );
        process.exit(1);
      }

      const store = new SemanticIndexStore();
      const dbPath = path.isAbsolute(semanticConfig.storage.path)
        ? semanticConfig.storage.path
        : path.join(repoRoot, semanticConfig.storage.path);
      store.init(dbPath);

      const embedder = createEmbedder(semanticConfig.embeddings);
      const eventBus: EventBus = { emit: async () => {} };
      const searchService = new SemanticSearchService({
        store,
        embedder,
        eventBus,
      });

      const topK = parseInt(options.topk, 10);
      const runId = Date.now().toString();

      const results = await searchService.search(query, topK, runId);

      if (globalOpts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log('No results found.');
          return;
        }
        for (const hit of results) {
          console.log(
            `${hit.path}:${hit.startLine}-${hit.endLine} (score: ${hit.score.toFixed(4)})`,
          );
          console.log('---');
          console.log(hit.content);
          console.log('---\n');
        }
      }
    });
}
