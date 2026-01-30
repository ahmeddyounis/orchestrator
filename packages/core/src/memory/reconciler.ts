import type { MemoryEntry, MemoryStore } from '@orchestrator/memory';
import type { Index, IndexFile } from '@orchestrator/repo';

export async function reconcileMemoryStaleness(
  repoId: string,
  index: Index,
  memoryStore: MemoryStore,
): Promise<{ markedStaleCount: number; clearedStaleCount: number }> {
  const entries = memoryStore.listEntriesForRepo(repoId);
  const entriesWithFiles = entries.filter((e: MemoryEntry) => e.fileRefsJson);

  if (entriesWithFiles.length === 0) {
    return { markedStaleCount: 0, clearedStaleCount: 0 };
  }

  const indexFileMap = new Map(index.files.map((f: IndexFile) => [f.path, f]));

  let markedStaleCount = 0;
  let clearedStaleCount = 0;

  for (const entry of entriesWithFiles) {
    const fileRefs = JSON.parse(entry.fileRefsJson!) as string[];
    const fileHashes = JSON.parse(entry.fileHashesJson!) as Record<
      string,
      string
    >;

    let isStale = false;
    for (const filePath of fileRefs) {
      const indexFile = indexFileMap.get(filePath);
      if (!indexFile || !indexFile.sha256) {
        isStale = true;
        break;
      }

      const storedHash = fileHashes[filePath];
      if (!storedHash || storedHash !== indexFile.sha256) {
        isStale = true;
        break;
      }
    }

    if (isStale && !entry.stale) {
      memoryStore.updateStaleFlag(entry.id, true);
      markedStaleCount++;
    } else if (!isStale && entry.stale) {
      memoryStore.updateStaleFlag(entry.id, false);
      clearedStaleCount++;
    }
  }

  return { markedStaleCount, clearedStaleCount };
}
