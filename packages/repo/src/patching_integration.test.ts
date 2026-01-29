import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { GitService } from './git';
import { PatchApplier } from './patch/applier';

describe('Patching and Git Workflow Integration', () => {
  let tempDir: string;
  let gitService: GitService;
  let patchApplier: PatchApplier;

  const setupTempRepo = async () => {
    // Create temp dir
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrator-repo-test-'));

    // Copy fixture to temp dir
    // Use fs.cp (available in Node 16.7+)
    const fixturePath = path.resolve(__dirname, '__fixtures__/patch-repo');
    await fs.cp(fixturePath, tempDir, { recursive: true });

    // Init git
    gitService = new GitService({ repoRoot: tempDir });

    // Helper to run git commands
    const { spawn } = await import('child_process');
    const runGit = (args: string[]) =>
      new Promise<void>((resolve, reject) => {
        const proc = spawn('git', args, { cwd: tempDir });
        proc.on('close', (code) =>
          code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} failed`)),
        );
      });

    await runGit(['init']);
    // Configure user for commit to work
    await runGit(['config', 'user.email', 'test@example.com']);
    await runGit(['config', 'user.name', 'Test User']);

    // Initial commit
    await runGit(['add', '.']);
    await runGit(['commit', '-m', 'Initial commit']);
  };

  beforeEach(async () => {
    await setupTempRepo();
    patchApplier = new PatchApplier();
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('sets up the temp repo correctly', async () => {
    const status = await gitService.getStatusPorcelain();
    expect(status).toBe('');
    const head = await gitService.getHeadSha();
    expect(head).toBeDefined();

    const content = await fs.readFile(path.join(tempDir, 'packages/a/src/index.ts'), 'utf-8');
    expect(content).toBe("console.log('hello');\n");

    const utilContent = await fs.readFile(path.join(tempDir, 'packages/b/src/util.ts'), 'utf-8');
    expect(utilContent).toBe("export const util = () => 'util';\n");
  });

  it('applies a valid diff and verifies file content changed', async () => {
    const diff = `diff --git a/packages/a/src/index.ts b/packages/a/src/index.ts
index e69de29..363a325 100644
--- a/packages/a/src/index.ts
+++ b/packages/a/src/index.ts
@@ -1 +1 @@
-console.log('hello');
+console.log('world');
`;
    const result = await patchApplier.applyUnifiedDiff(tempDir, diff);
    expect(result.applied).toBe(true);
    expect(result.filesChanged).toContain('packages/a/src/index.ts');

    const content = await fs.readFile(path.join(tempDir, 'packages/a/src/index.ts'), 'utf-8');
    expect(content).toBe("console.log('world');\n");
  });

  it('rejects path traversal diff', async () => {
    const diff = `diff --git a/../secret.txt b/../secret.txt
index e69de29..363a325 100644
--- a/../secret.txt
+++ b/../secret.txt
@@ -1 +1 @@
-secret
+exposed
`;
    const result = await patchApplier.applyUnifiedDiff(tempDir, diff);
    expect(result.applied).toBe(false);
    expect(result.error?.type).toBe('security');
    expect(result.error?.message).toContain('Path traversal');
  });

  it('supports branch creation and auto-commit via GitService', async () => {
    // Make a change
    await fs.writeFile(path.join(tempDir, 'newfile.txt'), 'content');

    // Create/Checkout branch - should fail if dirty?
    // Wait, createAndCheckoutBranch just does checkout -b or checkout.
    // It doesn't check for dirty unless we call ensureCleanWorkingTree.

    await gitService.createAndCheckoutBranch('feature/test');
    const branch = await gitService.currentBranch();
    expect(branch).toBe('feature/test');

    // Stage and commit
    await gitService.stageAll();
    await gitService.commit('Add newfile');

    const status = await gitService.getStatusPorcelain();
    expect(status).toBe('');
  });

  it('creates checkpoint and rolls back exact state', async () => {
    // 1. Create checkpoint
    const initialHead = await gitService.createCheckpoint('pre-change');

    // 2. Make some changes (modify and add)
    await fs.writeFile(path.join(tempDir, 'packages/a/src/index.ts'), "console.log('modified');\n");
    await fs.writeFile(path.join(tempDir, 'garbage.txt'), 'trash');

    // 3. Rollback
    await gitService.rollbackToCheckpoint(initialHead);

    // 4. Verify
    const content = await fs.readFile(path.join(tempDir, 'packages/a/src/index.ts'), 'utf-8');
    expect(content).toBe("console.log('hello');\n");

    const garbageExists = await fs
      .stat(path.join(tempDir, 'garbage.txt'))
      .then(() => true)
      .catch(() => false);
    expect(garbageExists).toBe(false);
  });

  it('fails apply and ensures rollback (integration logic)', async () => {
    // This test simulates the Orchestrator's logic: Checkpoint -> Apply -> Verify -> Rollback if fail.
    // Here we just test that if we apply a bad patch (that partially applies or fails), we can recover.
    // Git apply is atomic usually?
    // "git apply --reject" or without "--atomic" might leave mess.
    // PatchApplier uses "git apply". By default it is NOT atomic for multiple files unless --index or --3way is used or -atomic is passed?
    // Actually git apply is all-or-nothing by default for the files involved unless --reject is used.
    // Let's verify this behavior or simulate a case where we manually messed up.

    const initialHead = await gitService.createCheckpoint('pre-bad-patch');

    // Make a change that conflicts with the patch we are about to apply
    await fs.writeFile(path.join(tempDir, 'packages/a/src/index.ts'), "console.log('conflict');\n");

    // Create a patch that expects "console.log('hello');"
    const diff = `diff --git a/packages/a/src/index.ts b/packages/a/src/index.ts
index e69de29..363a325 100644
--- a/packages/a/src/index.ts
+++ b/packages/a/src/index.ts
@@ -1 +1 @@
-console.log('hello');
+console.log('world');
`;

    // Apply should fail
    const result = await patchApplier.applyUnifiedDiff(tempDir, diff);
    expect(result.applied).toBe(false);
    expect(result.error).toBeDefined();

    // Verify state is "dirty" with our manual conflict change?
    // "git apply" shouldn't touch the file if it fails.
    let content = await fs.readFile(path.join(tempDir, 'packages/a/src/index.ts'), 'utf-8');
    expect(content).toBe("console.log('conflict');\n");

    // But if we want to ensure rollback works even if something weird happened:
    await gitService.rollbackToCheckpoint(initialHead);

    // Should be back to initial state (before we made the conflict change, because we checkpointed BEFORE that?)
    // Wait, createCheckpoint commits changes.
    // If we call createCheckpoint('pre-bad-patch') when tree is clean, it returns current HEAD.
    // Then we made 'conflict' change.
    // Then apply failed.
    // Then rollback.
    // Rollback resets hard to HEAD. So 'conflict' change should be gone.

    content = await fs.readFile(path.join(tempDir, 'packages/a/src/index.ts'), 'utf-8');
    expect(content).toBe("console.log('hello');\n");
  });
});
