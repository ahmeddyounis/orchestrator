import fs from "node:fs";
import path from "node:path";
import { INDEX_SCHEMA_VERSION, type IndexFile } from "./types";

export { INDEX_SCHEMA_VERSION } from "./types";
export type { IndexFile } from "./types";

export class IndexCorruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexCorruptedError";
  }
}

export function validateIndex(indexFile: unknown): asserts indexFile is IndexFile {
  if (typeof indexFile !== "object" || indexFile === null) {
    throw new IndexCorruptedError("Index is not an object.");
  }

  const { schemaVersion } = indexFile as IndexFile;
  if (schemaVersion !== INDEX_SCHEMA_VERSION) {
    throw new IndexCorruptedError(
      `Unsupported index schema version: found ${schemaVersion}, expected ${INDEX_SCHEMA_VERSION}.`,
    );
  }
  // Add more validation logic here as needed based on the spec
}

export function loadIndex(indexPath: string): IndexFile | null {
  if (!fs.existsSync(indexPath)) {
    return null;
  }

  const content = fs.readFileSync(indexPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new IndexCorruptedError(`Failed to parse index file: ${(error as Error).message}`);
  }

  validateIndex(parsed);

  return parsed;
}

export function saveIndexAtomic(indexPath: string, indexFile: IndexFile): void {
  validateIndex(indexFile);

  const tempPath = `${indexPath}.tmp`;
  const dir = path.dirname(indexPath);

  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(tempPath, JSON.stringify(indexFile, null, 2));
  fs.renameSync(tempPath, indexPath);
}
