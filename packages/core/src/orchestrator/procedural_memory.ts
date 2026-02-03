import { Config } from '@orchestrator/shared';
import {
  ProceduralMemory,
  ProceduralMemoryEntry,
  ProceduralMemoryQuery,
  createMemoryStore,
} from '@orchestrator/memory';
import path from 'path';

export class ProceduralMemoryImpl implements ProceduralMemory {
  constructor(
    private config: Config,
    private repoRoot: string,
  ) {}

  private resolveMemoryDbPath(): string | undefined {
    const p = this.config.memory?.storage?.path;
    if (!p) return undefined;
    return path.isAbsolute(p) ? p : path.join(this.repoRoot, p);
  }

  async find(queries: ProceduralMemoryQuery[], limit: number): Promise<ProceduralMemoryEntry[][]> {
    const dbPath = this.resolveMemoryDbPath();
    if (!dbPath) {
      return queries.map(() => []);
    }
    const store = createMemoryStore();
    try {
      const keyEnvVar = this.config.security?.encryption?.keyEnv ?? 'ORCHESTRATOR_ENC_KEY';
      const key = process.env[keyEnvVar];

      store.init({
        dbPath,
        encryption: {
          encryptAtRest: this.config.memory?.storage?.encryptAtRest ?? false,
          key: key || '',
        },
      });

      const repoId = this.repoRoot; // Assuming repoRoot is the repoId
      const allProcedural = store.list(repoId, 'procedural');

      const results: ProceduralMemoryEntry[][] = [];
      for (const query of queries) {
        const filtered = allProcedural.filter((entry) => {
          if (query.titleContains && !entry.title.includes(query.titleContains)) {
            return false;
          }
          return true;
        });
        results.push(filtered.slice(0, limit));
      }
      return results;
    } finally {
      store.close();
    }
  }
}
