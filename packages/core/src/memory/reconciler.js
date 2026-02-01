'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.reconcileMemoryStaleness = reconcileMemoryStaleness;
async function reconcileMemoryStaleness(repoId, index, memoryStore) {
  const entries = memoryStore.listEntriesForRepo(repoId);
  const entriesWithFiles = entries.filter((e) => e.fileRefsJson);
  if (entriesWithFiles.length === 0) {
    return { markedStaleCount: 0, clearedStaleCount: 0 };
  }
  const indexFileMap = new Map(index.files.map((f) => [f.path, f]));
  let markedStaleCount = 0;
  let clearedStaleCount = 0;
  for (const entry of entriesWithFiles) {
    const fileRefs = JSON.parse(entry.fileRefsJson);
    const fileHashes = JSON.parse(entry.fileHashesJson);
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
//# sourceMappingURL=reconciler.js.map
