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
});
