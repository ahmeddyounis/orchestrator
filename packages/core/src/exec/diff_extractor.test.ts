import { describe, it, expect } from 'vitest';
import { extractUnifiedDiff } from './diff_extractor';

describe('extractUnifiedDiff', () => {
  it('returns null for undefined input', () => {
    expect(extractUnifiedDiff(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractUnifiedDiff('')).toBeNull();
  });

  it('extracts diff from BEGIN_DIFF/END_DIFF markers', () => {
    const input = `Some preamble
BEGIN_DIFF
diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,1 @@
-const x = 1;
+const x = 2;
END_DIFF
Some trailing text`;

    const diff = extractUnifiedDiff(input);
    expect(diff).toContain('diff --git a/file.ts b/file.ts');
    expect(diff).toContain('-const x = 1;');
    expect(diff).toContain('+const x = 2;');
    expect(diff).not.toContain('BEGIN_DIFF');
    expect(diff).not.toContain('END_DIFF');
    expect(diff).not.toContain('preamble');
  });

  it('extracts diff from <BEGIN_DIFF>/<END_DIFF> markers', () => {
    const input = `Header
<BEGIN_DIFF>
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-a
+b
<END_DIFF>
Footer`;

    const diff = extractUnifiedDiff(input);
    expect(diff).toContain('diff --git a/a.ts b/a.ts');
    expect(diff).toContain('-a');
    expect(diff).toContain('+b');
  });

  it('extracts diff from <BEGIN_DIFF>...</END_DIFF> markers', () => {
    const input = `Header
<BEGIN_DIFF>
diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-a
+b
</END_DIFF>
Footer`;

    const diff = extractUnifiedDiff(input);
    expect(diff).toContain('diff --git a/a.ts b/a.ts');
    expect(diff).toContain('-a');
    expect(diff).toContain('+b');
    expect(diff).not.toContain('Footer');
  });

  it('extracts diff from ```diff fenced block', () => {
    const input = `Here is the patch:
\`\`\`diff
diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,1 @@
-x
+y
\`\`\`
Done.`;

    const diff = extractUnifiedDiff(input);
    expect(diff).toContain('diff --git a/x.ts b/x.ts');
    expect(diff).toContain('-x');
    expect(diff).toContain('+y');
    expect(diff).not.toContain('```diff');
  });

  it('does not include trailing chatter when extracting raw diff', () => {
    const input = `diff --git a/foo.txt b/foo.txt
--- a/foo.txt
+++ b/foo.txt
@@ -1,1 +1,1 @@
-a
+b
All done!`;

    const diff = extractUnifiedDiff(input);
    expect(diff).toContain('diff --git a/foo.txt b/foo.txt');
    expect(diff).toContain('+b');
    expect(diff).not.toContain('All done!');
  });

  it('extracts raw diff starting at "diff --git"', () => {
    const input = `Noise
diff --git a/foo.txt b/foo.txt
--- a/foo.txt
+++ b/foo.txt
@@ -1,1 +1,1 @@
-a
+b`;

    const diff = extractUnifiedDiff(input);
    expect(diff?.startsWith('diff --git')).toBe(true);
  });

  it('extracts raw diff starting at "--- a/"', () => {
    const input = `Noise
--- a/foo.txt
+++ b/foo.txt
@@ -1,1 +1,1 @@
-a
+b`;

    const diff = extractUnifiedDiff(input);
    expect(diff?.startsWith('--- a/')).toBe(true);
  });

  it('extracts hunk-only fragment starting at "@@ "', () => {
    const input = `Some chatty text
@@ -1,1 +1,1 @@
-a
+b
More text`;

    const diff = extractUnifiedDiff(input);
    expect(diff?.startsWith('@@ ')).toBe(true);
    expect(diff).toContain('-a');
    expect(diff).toContain('+b');
  });

  it('returns null when no diff-like content exists', () => {
    expect(extractUnifiedDiff('Just some random text\nwith no diff')).toBeNull();
  });

  it('falls back to heuristic extraction when END_DIFF is missing', () => {
    const input = `Preamble
BEGIN_DIFF
diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,1 @@
-a
+b`;

    const diff = extractUnifiedDiff(input);
    expect(diff).toContain('diff --git a/file.ts b/file.ts');
    expect(diff).toContain('+b');
  });

  it('falls back to heuristic extraction when ```diff fence is unterminated', () => {
    const input = `Intro
\`\`\`diff
diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,1 @@
-x
+y`;

    const diff = extractUnifiedDiff(input);
    expect(diff).toContain('diff --git a/x.ts b/x.ts');
    expect(diff).toContain('+y');
  });

  it('returns trimmed marker content when markers exist but no diff is present', () => {
    const input = `BEGIN_DIFF
not actually a diff
END_DIFF`;
    expect(extractUnifiedDiff(input)).toBe('not actually a diff');
  });

  it('handles --- a/ without a following +++ line', () => {
    const input = `--- a/foo.txt`;
    expect(extractUnifiedDiff(input)).toBeNull();
  });

  it('extracts hunk fragments with blank lines', () => {
    const input = `@@ -1,1 +1,1 @@
-a

+b
More text`;
    const diff = extractUnifiedDiff(input);
    expect(diff?.startsWith('@@ ')).toBe(true);
    expect(diff).toContain('-a');
    expect(diff).toContain('+b');
  });

  it('dedents indented diffs', () => {
    const input = `  diff --git a/a.ts b/a.ts
  --- a/a.ts
  +++ b/a.ts
  @@ -1,1 +1,1 @@
  -a
  +b`;
    const diff = extractUnifiedDiff(input);
    expect(diff?.startsWith('diff --git')).toBe(true);
    expect(diff).toContain('+b');
  });
});
