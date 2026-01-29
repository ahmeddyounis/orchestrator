import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { PatchApplier } from './applier';

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
});
