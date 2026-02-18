import { describe, it, expect } from 'vitest';
import { tryRepairUnifiedDiff } from './diff_repair';
import os from 'node:os';
import path from 'node:path';
import * as fsSync from 'node:fs';

describe('tryRepairUnifiedDiff', () => {
  it('inserts missing file headers in a diff --git block', () => {
    const input = ['diff --git a/foo.txt b/foo.txt', '@@ -1,1 +1,1 @@', '-a', '+b', ''].join('\n');

    const repaired = tryRepairUnifiedDiff(input, { repoRoot: '/', stepHint: 'Update foo.txt' });
    expect(repaired?.diffText).toContain('--- a/foo.txt');
    expect(repaired?.diffText).toContain('+++ b/foo.txt');
    expect(repaired?.diffText).toContain('@@ -1,1 +1,1 @@');
  });

  it('wraps a hunk-only fragment with inferred file headers', () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-diff-repair-'));
    try {
      const input = ['@@ -1,1 +1,1 @@', '-a', '+b'].join('\n');

      const repaired = tryRepairUnifiedDiff(input, {
        repoRoot: tmp,
        stepHint: 'Fix bug in src/foo.ts',
      });

      expect(repaired?.diffText).toContain('diff --git a/src/foo.ts b/src/foo.ts');
      expect(repaired?.diffText).toContain('--- a/src/foo.ts');
      expect(repaired?.diffText).toContain('+++ b/src/foo.ts');
      expect(repaired?.diffText).toContain('@@ -1,1 +1,1 @@');
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('uses /dev/null headers for new-file hunks', () => {
    const input = ['@@ -0,0 +1,2 @@', '+a', '+b'].join('\n');
    const repaired = tryRepairUnifiedDiff(input, {
      repoRoot: '/',
      stepHint: 'Add new file src/new.ts',
    });

    expect(repaired?.diffText).toContain('--- /dev/null');
    expect(repaired?.diffText).toContain('+++ b/src/new.ts');
  });

  it('does not wrap fragments when multiple file paths are present', () => {
    const input = ['@@ -1,1 +1,1 @@', '-a', '+b'].join('\n');
    const repaired = tryRepairUnifiedDiff(input, {
      repoRoot: '/',
      stepHint: 'Touch both src/a.ts and src/b.ts',
    });
    expect(repaired).toBeNull();
  });

  it('returns null when the diff already has file headers', () => {
    const input = [
      'diff --git a/foo.txt b/foo.txt',
      '--- a/foo.txt',
      '+++ b/foo.txt',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
    ].join('\n');

    expect(tryRepairUnifiedDiff(input, { repoRoot: '/', stepHint: 'Update foo.txt' })).toBeNull();
  });

  it('inserts a missing new-file header when only "---" is present', () => {
    const input = [
      'diff --git a/foo.txt b/foo.txt',
      '--- a/foo.txt',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '',
    ].join('\n');

    const repaired = tryRepairUnifiedDiff(input, { repoRoot: '/', stepHint: 'Update foo.txt' });
    expect(repaired?.diffText).toContain('--- a/foo.txt');
    expect(repaired?.diffText).toContain('+++ b/foo.txt');
  });

  it('inserts a missing old-file header when only "+++" is present', () => {
    const input = [
      'diff --git a/foo.txt b/foo.txt',
      '+++ b/foo.txt',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '',
    ].join('\n');

    const repaired = tryRepairUnifiedDiff(input, { repoRoot: '/', stepHint: 'Update foo.txt' });
    expect(repaired?.diffText).toContain('--- a/foo.txt');
    expect(repaired?.diffText).toContain('+++ b/foo.txt');
  });

  it('uses /dev/null headers for new file mode and deleted file mode blocks', () => {
    const newFile = [
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      '@@ -0,0 +1,1 @@',
      '+a',
    ].join('\n');

    const repairedNew = tryRepairUnifiedDiff(newFile, { repoRoot: '/', stepHint: 'Add new.txt' });
    expect(repairedNew?.diffText).toContain('--- /dev/null');
    expect(repairedNew?.diffText).toContain('+++ b/new.txt');

    const deleted = [
      'diff --git a/old.txt b/old.txt',
      'deleted file mode 100644',
      '@@ -1,1 +0,0 @@',
      '-a',
    ].join('\n');

    const repairedDeleted = tryRepairUnifiedDiff(deleted, {
      repoRoot: '/',
      stepHint: 'Delete old.txt',
    });
    expect(repairedDeleted?.diffText).toContain('--- a/old.txt');
    expect(repairedDeleted?.diffText).toContain('+++ /dev/null');
  });

  it('wraps delete-mode hunks with +++ /dev/null when inferred', () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-diff-repair-'));
    try {
      fsSync.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fsSync.writeFileSync(path.join(tmp, 'src', 'to_delete.ts'), 'a\nb\n', 'utf8');

      const input = ['@@ -1,1 +0,0 @@', '-a'].join('\n');
      const repaired = tryRepairUnifiedDiff(input, {
        repoRoot: tmp,
        stepHint: 'Remove code in src/to_delete.ts',
      });

      expect(repaired?.diffText).toContain('diff --git a/src/to_delete.ts b/src/to_delete.ts');
      expect(repaired?.diffText).toContain('+++ /dev/null');
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not wrap hunk fragments when no step hint is available', () => {
    const input = ['@@ -1,1 +1,1 @@', '-a', '+b'].join('\n');
    expect(tryRepairUnifiedDiff(input, { repoRoot: '/' })).toBeNull();
  });

  it('returns null when a diff --git line does not match the expected pattern', () => {
    const input = ['diff --git foo bar', '@@ -1,1 +1,1 @@', '-a', '+b'].join('\n');
    expect(tryRepairUnifiedDiff(input, { repoRoot: '/', stepHint: 'Update foo' })).toBeNull();
  });

  it('does not wrap hunk fragments when step hint has no file paths', () => {
    const input = ['@@ -1,1 +1,1 @@', '-a', '+b'].join('\n');
    expect(tryRepairUnifiedDiff(input, { repoRoot: '/', stepHint: 'Fix the bug' })).toBeNull();
  });

  it('does not wrap hunk fragments when inferred file path contains ".."', () => {
    const input = ['@@ -1,1 +1,1 @@', '-a', '+b'].join('\n');
    expect(
      tryRepairUnifiedDiff(input, { repoRoot: '/', stepHint: 'Fix ../src/foo.ts please' }),
    ).toBeNull();
  });

  it('returns null when multiple candidate paths exist in the repo', () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-diff-repair-'));
    try {
      fsSync.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fsSync.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'a\n', 'utf8');
      fsSync.writeFileSync(path.join(tmp, 'src', 'b.ts'), 'b\n', 'utf8');

      const input = ['@@ -1 +1 @@', '-a', '+b'].join('\n');
      expect(
        tryRepairUnifiedDiff(input, { repoRoot: tmp, stepHint: 'Touch src/a.ts and src/b.ts' }),
      ).toBeNull();
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('treats invalid hunk headers as modify-mode when wrapping', () => {
    const tmp = fsSync.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-diff-repair-'));
    try {
      const input = ['@@ invalid @@', '-a', '+b'].join('\n');
      const repaired = tryRepairUnifiedDiff(input, {
        repoRoot: tmp,
        stepHint: 'Fix bug in src/foo.ts',
      });

      expect(repaired?.diffText).toContain('diff --git a/src/foo.ts b/src/foo.ts');
      expect(repaired?.diffText).toContain('@@ invalid @@');
    } finally {
      fsSync.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
