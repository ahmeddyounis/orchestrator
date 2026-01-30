import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { IndexManager } from './index';

describe('IndexManager', () => {
  let tmpDir: string;
  let manager: IndexManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestator-test-'));
    await fs.writeFile(path.join(tmpDir, 'file1.txt'), 'hello');
    await fs.writeFile(path.join(tmpDir, 'file2.txt'), 'world');
    await fs.mkdir(path.join(tmpDir, 'subdir'));
    await fs.writeFile(path.join(tmpDir, 'subdir', 'file3.txt'), 'nested');

    manager = new IndexManager(tmpDir, {
      enabled: true,
      path: '.orchestrator/index.json',
      mode: 'on-demand',
      hashAlgorithm: 'sha256',
      maxFileSizeBytes: 1000,
    });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should build an index from scratch', async () => {
    const report = await manager.build();
    expect(report.fileCount).toBe(3);
    expect(report.hashedCount).toBe(3);
    expect(report.repoRoot).toBe(tmpDir);

    const index = await manager.readIndex();
    expect(index).not.toBeNull();
    expect(Object.keys(index!.files).length).toBe(3);
    expect(index!.files['file1.txt'].hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('should get the status of an existing index', async () => {
    await manager.build();
    const status = await manager.status();
    expect(status).not.toBeNull();
    expect(status!.fileCount).toBe(3);
  });
  
  it('should return null status if no index exists', async () => {
    const status = await manager.status();
    expect(status).toBeNull();
  });

  it('should update an existing index', async () => {
    await manager.build();
    
    // Modify a file
    await fs.writeFile(path.join(tmpDir, 'file1.txt'), 'hello world');
    // Add a file
    await fs.writeFile(path.join(tmpDir, 'file4.txt'), 'new file');
    // Delete a file
    await fs.unlink(path.join(tmpDir, 'file2.txt'));
    
    const report = await manager.update();
    expect(report.fileCount).toBe(3);
    expect(report.delta).toEqual({ added: 1, removed: 1, changed: 1 });
    
    const index = await manager.readIndex();
    expect(Object.keys(index!.files).length).toBe(3);
    expect(index!.files['file1.txt'].hash).not.toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(index!.files['file4.txt']).toBeDefined();
    expect(index!.files['file2.txt']).toBeUndefined();
  });
  
  it('should run a full build on update if no index exists', async () => {
    const report = await manager.update();
    expect(report.fileCount).toBe(3);
    expect(report.delta).toBeUndefined();
  });
});
