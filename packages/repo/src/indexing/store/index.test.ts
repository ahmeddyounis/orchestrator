import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadIndex,
  saveIndexAtomic,
  validateIndex,
  IndexCorruptedError,
} from "./index";
import { INDEX_SCHEMA_VERSION, type IndexFile } from "./types";

describe("IndexStore", () => {
  let tempDir: string;
  let indexPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "index-store-test-"));
    indexPath = path.join(tempDir, "index.json");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const validIndex: IndexFile = {
    schemaVersion: INDEX_SCHEMA_VERSION,
    repoId: "test-repo",
    repoRoot: "/path/to/repo",
    builtAt: Date.now(),
    updatedAt: Date.now(),
    files: [
      {
        path: "file1.ts",
        sizeBytes: 100,
        mtimeMs: Date.now(),
        isText: true,
      },
    ],
    stats: {
      fileCount: 1,
      textFileCount: 1,
      hashedCount: 1,
      byLanguage: { typescript: { count: 1, bytes: 100 } },
    },
  };

  describe("saveIndexAtomic and loadIndex", () => {
    it("should save and load an index file correctly", () => {
      saveIndexAtomic(indexPath, validIndex);
      const loadedIndex = loadIndex(indexPath);
      expect(loadedIndex).toEqual(validIndex);
    });

    it("should return null if the index file does not exist", () => {
      const loadedIndex = loadIndex(indexPath);
      expect(loadedIndex).toBeNull();
    });

    it("should perform an atomic write", () => {
      const tempPath = `${indexPath}.tmp`;
      saveIndexAtomic(indexPath, validIndex);
      expect(fs.existsSync(indexPath)).toBe(true);
      expect(fs.existsSync(tempPath)).toBe(false);
    });
  });

  describe("validateIndex", () => {
    it("should not throw for a valid index", () => {
      expect(() => validateIndex(validIndex)).not.toThrow();
    });

    it("should throw IndexCorruptedError for a non-object", () => {
      expect(() => validateIndex("not-an-object")).toThrow(IndexCorruptedError);
      expect(() => validateIndex("not-an-object")).toThrow(
        "Index is not an object.",
      );
    });



    it("should throw IndexCorruptedError for incorrect schema version", () => {
      const invalidIndex = { ...validIndex, schemaVersion: 999 };
      expect(() => validateIndex(invalidIndex)).toThrow(IndexCorruptedError);
      expect(() => validateIndex(invalidIndex)).toThrow(
        "Unsupported index schema version: found 999, expected 1.",
      );
    });
  });

  describe("loadIndex error handling", () => {
    it("should throw IndexCorruptedError for invalid JSON", () => {
      fs.writeFileSync(indexPath, "invalid json");
      expect(() => loadIndex(indexPath)).toThrow(IndexCorruptedError);
      expect(() => loadIndex(indexPath)).toThrow(
        /Failed to parse index file/,
      );
    });

    it("should throw IndexCorruptedError for a file that fails validation", () => {
      const invalidIndex = { ...validIndex, schemaVersion: 999 };
      fs.writeFileSync(indexPath, JSON.stringify(invalidIndex));
      expect(() => loadIndex(indexPath)).toThrow(IndexCorruptedError);
    });
  });
});
