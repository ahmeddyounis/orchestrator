import { describe, it, expect } from 'vitest';
import { extractUnifiedDiff } from './diff_extractor';

describe('extractUnifiedDiff', () => {
  describe('edge cases', () => {
    it('returns null for undefined input', () => {
      expect(extractUnifiedDiff(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(extractUnifiedDiff('')).toBeNull();
    });

    it('returns null when no diff is found', () => {
      expect(extractUnifiedDiff('Just some random text\nwith no diff')).toBeNull();
    });

    it('returns null for text with unrelated content', () => {
      const input = `
Here is some explanation about the code.
The function does X and Y.
No actual diff here.
`;
      expect(extractUnifiedDiff(input)).toBeNull();
    });
  });

  describe('Strategy 1: Marker blocks (BEGIN_DIFF/END_DIFF)', () => {
    it('extracts diff with BEGIN_DIFF/END_DIFF markers', () => {
      const input = `
Some preamble text here.
BEGIN_DIFF
diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
-const x = 1;
+const x = 2;
END_DIFF
Some trailing text.
`;
      const result = extractUnifiedDiff(input);
      expect(result).toContain('diff --git a/file.ts b/file.ts');
      expect(result).toContain('-const x = 1;');
      expect(result).toContain('+const x = 2;');
      expect(result).not.toContain('BEGIN_DIFF');
      expect(result).not.toContain('END_DIFF');
      expect(result).not.toContain('preamble');
    });

    it('extracts diff with angle bracket markers <BEGIN_DIFF>/
