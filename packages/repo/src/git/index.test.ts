import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { GitService } from './index';

const run = (cmd: string, args: string[], cwd: string) => {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'ignore' });
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command ${cmd} ${args.join(' ')} failed with code ${code}`));
    });
    p.on('error', reject);
  });
};

describe('GitService', () => {
  let tmpDir: string;
  let gitService: GitService;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-service-test-'));
    gitService = new GitService({ repoRoot: tmpDir });

    // Init git repo
    await run('git', ['init'], tmpDir);
    // Determine the default branch name (init.defaultBranch might vary)
    // We force it to main to be consistent
    await run('git', ['branch', '-m', 'main'], tmpDir).catch(() => {}); // might fail if no commits yet, which is fine
    await run('git', ['config', 'user.email', 'test@example.com'], tmpDir);
    await run('git', ['config', 'user.name', 'Test User'], tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects clean working tree', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    const status = await gitService.getStatusPorcelain();
    expect(status).toBe('');
    await expect(gitService.ensureCleanWorkingTree()).resolves.not.toThrow();
  });

  it('detects dirty working tree', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await fs.writeFile(path.join(tmpDir, 'dirty.txt'), 'content');

    const status = await gitService.getStatusPorcelain();
    expect(status).toContain('?? dirty.txt');

    await expect(gitService.ensureCleanWorkingTree()).rejects.toThrow('Working tree is dirty');
    await expect(gitService.ensureCleanWorkingTree({ allowDirty: true })).resolves.not.toThrow();
  });

  it('gets current branch', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    // Ensure we are on a branch
    await run('git', ['checkout', '-b', 'main'], tmpDir).catch(() => {}); // in case init didn't create it
    const branch = await gitService.currentBranch();
    expect(branch).toBe('main'); // default branch
  });

  it('creates and checks out branch', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await gitService.createAndCheckoutBranch('agent/run-123');
    const branch = await gitService.currentBranch();
    expect(branch).toBe('agent/run-123');
  });

  it('handles existing branch in createAndCheckoutBranch', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await run('git', ['branch', 'agent/run-123'], tmpDir);
    await gitService.createAndCheckoutBranch('agent/run-123');
    const branch = await gitService.currentBranch();
    expect(branch).toBe('agent/run-123');
  });

  it('stages all changes', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
    await gitService.stageAll();
    const status = await gitService.getStatusPorcelain();
    expect(status).toContain('A  file.txt');
  });

  it('commits changes', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
    await gitService.stageAll();
    await gitService.commit('Add file.txt');
    const status = await gitService.getStatusPorcelain();
    expect(status).toBe('');
  });

  it('gets head sha', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    const sha = await gitService.getHeadSha();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('diffs to head', async () => {
    await run('git', ['commit', '--allow-empty', '-m', 'Initial commit'], tmpDir);
    await fs.writeFile(path.join(tmpDir, 'file.txt'), 'content');
    // Diff only shows changes to tracked files if they are modified.
    // Untracked files are not shown in 'git diff HEAD' unless staged?
    // 'git diff HEAD' shows staged and unstaged changes.
    // Untracked files are NOT shown in 'git diff HEAD'.

    // Let's stage it first so it is tracked?
    await gitService.stageAll();

    const diff = await gitService.diffToHead();
    expect(diff).toContain('diff --git a/file.txt b/file.txt');
  });
});
