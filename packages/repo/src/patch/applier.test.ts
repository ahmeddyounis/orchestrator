import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { PatchApplier } from './applier';
import { PatchErrorKind, PatchApplyErrorDetail } from '@orchestrator/shared';

// Helper to run commands
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

describe('PatchApplier', () => {
  let tmpDir: string;
  let applier: PatchApplier;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'patch-test-'));
    applier = new PatchApplier();

    // Init git repo
    await run('git', ['init'], tmpDir);
    await run('git', ['config', 'user.email', 'test@example.com'], tmpDir);
    await run('git', ['config', 'user.name', 'Test User'], tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('applies a valid patch', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'Hello World\n');
    await run('git', ['add', 'test.txt'], tmpDir);
    await run('git', ['commit', '-m', 'Initial commit'], tmpDir);

    const diffText =
      [
        'diff --git a/test.txt b/test.txt',
        'index 557db03..980a0d5 100644',
        '--- a/test.txt',
        '+++ b/test.txt',
        '@@ -1 +1 @@',
        '-Hello World',
        '+Hello Universe',
        '',
      ].join('\n') + '\n';

    const result = await applier.applyUnifiedDiff(tmpDir, diffText);
    if (!result.applied) {
      console.error('Apply failed:', result.error);
    }
    expect(result.applied).toBe(true);
    expect(result.filesChanged).toContain('test.txt');

    const content = await fs.readFile(filePath, 'utf-8');
    expect(content).toBe('Hello Universe\n');
  });

  it('refuses path traversal', async () => {
    const diffText = [
      'diff --git a/../secret.txt b/../secret.txt',
      '--- a/../secret.txt',
      '+++ b/../secret.txt',
      '@@ -0,0 +1 @@',
      '+hacked',
      '',
    ].join('\n');

    const result = await applier.applyUnifiedDiff(tmpDir, diffText);
    expect(result.applied).toBe(false);
    expect(result.error?.type).toBe('security');
  });

  it('refuses binary files by default', async () => {
    const diffText = [
      'diff --git a/image.png b/image.png',
      'new file mode 100644',
      'index 0000000..1234567',
      'Binary files /dev/null and b/image.png differ',
      '--- a/image.png',
      '+++ b/image.png',
      '',
    ].join('\n');

    const result = await applier.applyUnifiedDiff(tmpDir, diffText);
    expect(result.applied).toBe(false);
    expect(result.error?.type).toBe('security');
    expect(result.error?.message).toContain('Binary file patch detected');
  });

  it('allows binary files if configured', async () => {
    const diffText = [
      'diff --git a/image.png b/image.png',
      'new file mode 100644',
      'index 0000000..1234567',
      'Binary files /dev/null and b/image.png differ',
      '--- a/image.png',
      '+++ b/image.png',
      '',
    ].join('\n');

    const result = await applier.applyUnifiedDiff(tmpDir, diffText, { allowBinary: true });

    // Validation should pass, but execution might fail because patch is fake.
    if (!result.applied) {
      expect(result.error?.type).not.toBe('security');
    }
  });

  it('enforces file limits', async () => {
    let diffText = '';
    for (let i = 0; i < 5; i++) {
      diffText += `diff --git a/file${i} b/file${i}\n--- a/file${i}\n+++ b/file${i}\n@@ -0,0 +1 @@\n+line\n`;
    }

    const result = await applier.applyUnifiedDiff(tmpDir, diffText, { maxFilesChanged: 2 });

    expect(result.applied).toBe(false);
    expect(result.error?.type).toBe('limit');
    expect(result.error?.message).toContain('Too many files changed');
  });

  it('reports specific error when hunk fails', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await fs.writeFile(filePath, 'Hello World\n');
    await run('git', ['add', 'test.txt'], tmpDir);
    await run('git', ['commit', '-m', 'Initial commit'], tmpDir);

    // Patch expects 'Hello Earth' but file has 'Hello World'
    const diffText =
      [
        'diff --git a/test.txt b/test.txt',
        'index 557db03..980a0d5 100644',
        '--- a/test.txt',
        '+++ b/test.txt',
        '@@ -1 +1 @@',
        '-Hello Earth',
        '+Hello Universe',
        '',
      ].join('\n') + '\n';

    const result = await applier.applyUnifiedDiff(tmpDir, diffText);
    expect(result.applied).toBe(false);
    expect(result.error?.type).toBe('execution');

    const details = result.error?.details as {
      kind: PatchErrorKind;
      errors: PatchApplyErrorDetail[];
    };
    expect(details.kind).toBe('HUNK_FAILED');
    expect(details.errors).toHaveLength(1);
    expect(details.errors[0]).toMatchObject({
      kind: 'HUNK_FAILED',
      file: 'test.txt',
      line: 1,
      suggestion: expect.any(String),
    });
  });

  it('reports specific error when file not found', async () => {
    // Patch expects 'missing.txt' to exist
    const diffText =
      [
        'diff --git a/missing.txt b/missing.txt',
        'index 557db03..980a0d5 100644',
        '--- a/missing.txt',
        '+++ b/missing.txt',
        '@@ -1 +1 @@',
        '-Old Content',
        '+New Content',
        '',
      ].join('\n') + '\n';

    const result = await applier.applyUnifiedDiff(tmpDir, diffText);
    expect(result.applied).toBe(false);

    const details = result.error?.details as {
      kind: PatchErrorKind;
      errors: PatchApplyErrorDetail[];
    };
    // Note: git apply might say "error: missing.txt: No such file or directory"
    // or sometimes simply fails. Let's verify.
    expect(details.kind).toBe('FILE_NOT_FOUND');
    expect(details.errors[0]).toMatchObject({
      kind: 'FILE_NOT_FOUND',
      file: 'missing.txt',
    });
  });

  it('reports specific error when file already exists', async () => {
    const filePath = path.join(tmpDir, 'existing.txt');
    await fs.writeFile(filePath, 'Existing Content\n');
    await run('git', ['add', 'existing.txt'], tmpDir); // Track it so git knows it exists?
    // Actually if it's untracked, git apply might still complain if it tries to overwrite?
    // "git apply" checks working tree.

    // Patch tries to create 'existing.txt'
    const diffText =
      [
        'diff --git a/existing.txt b/existing.txt',
        'new file mode 100644',
        'index 0000000..980a0d5',
        '--- /dev/null',
        '+++ b/existing.txt',
        '@@ -0,0 +1 @@',
        '+New Content',
        '',
      ].join('\n') + '\n';

    const result = await applier.applyUnifiedDiff(tmpDir, diffText);
    expect(result.applied).toBe(false);

    const details = result.error?.details as {
      kind: PatchErrorKind;
      errors: PatchApplyErrorDetail[];
    };
    expect(details.kind).toBe('ALREADY_EXISTS');
    expect(details.errors[0]).toMatchObject({
      kind: 'ALREADY_EXISTS',
      file: 'existing.txt',
    });
  });
});
