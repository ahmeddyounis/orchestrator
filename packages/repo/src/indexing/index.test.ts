import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { IndexManager } from "./index";
import { loadIndex } from "./store";
import { type Config } from "@orchestrator/shared";

describe("IndexManager", () => {
  let tmpDir: string;
  let manager: IndexManager;
  let indexPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orchestator-test-"));
    await fs.writeFile(path.join(tmpDir, "file1.txt"), "hello");
    await fs.writeFile(path.join(tmpDir, "file2.txt"), "world");
    await fs.mkdir(path.join(tmpDir, "subdir"));
    await fs.writeFile(path.join(tmpDir, "subdir", "file3.txt"), "nested");

    const config: Config["indexing"] = {
      enabled: true,
      path: ".orchestrator/index.json",
      mode: "on-demand",
      hashAlgorithm: "sha256",
      maxFileSizeBytes: 1000,
    };
    manager = new IndexManager(tmpDir, config);
    indexPath = path.join(tmpDir, config.path);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("should build an index from scratch", async () => {
    const report = await manager.build();
    expect(report.fileCount).toBe(3);
    expect(report.hashedCount).toBe(3);
    expect(report.repoRoot).toBe(tmpDir);

    const index = loadIndex(indexPath);
    expect(index).not.toBeNull();
    expect(index!.files.length).toBe(3);
    expect(index!.stats.fileCount).toBe(3);
  });

  it("should get the status of an existing index", async () => {
    await manager.build();
    const status = await manager.status();
    expect(status).not.toBeNull();
    expect(status!.fileCount).toBe(3);
  });

  it("should return null status if no index exists", async () => {
    const status = await manager.status();
    expect(status).toBeNull();
  });

  it("should update an existing index by rebuilding", async () => {
    await manager.build();

    // Modify a file
    await fs.writeFile(path.join(tmpDir, "file1.txt"), "hello world");
    // Add a file
    await fs.writeFile(path.join(tmpDir, "file4.txt"), "new file");
    // Delete a file
    await fs.unlink(path.join(tmpDir, "file2.txt"));

    const report = await manager.update();
    expect(report.fileCount).toBe(3);
    expect(report.delta).toBeUndefined(); // Rebuild doesn't produce a delta

    const index = loadIndex(indexPath);
    expect(index!.files.length).toBe(3);
    const filePaths = index!.files.map((f) => f.path);
    expect(filePaths).toContain("file1.txt");
    expect(filePaths).toContain("file4.txt");
    expect(filePaths).not.toContain("file2.txt");
  });

  it("should run a full build on update if no index exists", async () => {
    const report = await manager.update();
    expect(report.fileCount).toBe(3);
    expect(report.delta).toBeUndefined();
  });
});
