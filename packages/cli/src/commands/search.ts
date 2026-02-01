import { Command } from 'commander';
import { findRepoRoot, SemanticIndexStore, SemanticSearchService } from '@orchestrator/repo';
import { ConfigLoader } from '@orchestrator/core';
import { SemanticIndexingConfig } from '@orchestrator/shared';
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

      const flags: Record<string, unknown> = {};
      if (options.semantic) {
        flags.indexing = { semantic: { enabled: true } };
      }

      const config = ConfigLoader.load({
        configPath: globalOpts.config,
        flags,
      });

      if (!options.semantic) {
        // TODO: Implement procedural search
        console.error('Only semantic search is currently supported.');
        process.exit(1);
      }

      const semanticConfig = config.indexing?.semantic as SemanticIndexingConfig;
      if (!semanticConfig?.enabled) {
        console.error(
          'Semantic indexing is not enabled. Please enable it in your config or run `index build --semantic`.',
        );
        process.exit(1);
      }

      const store = new SemanticIndexStore();
      const dbPath = path.resolve(repoRoot, semanticConfig.path);
      store.init(dbPath);

      const embedder = createEmbedder(semanticConfig.embeddings);
      const searchService = new SemanticSearchService({
        store,
        embedder,
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
