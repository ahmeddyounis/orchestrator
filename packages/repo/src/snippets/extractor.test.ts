import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { SnippetExtractor } from './extractor';
import { SearchMatch } from '../search/types';

describe('SnippetExtractor', () => {
  let tmpDir: string;
  let extractor: SnippetExtractor;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snippet-test-'));
    extractor = new SnippetExtractor();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('extracts snippets with context', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    const content = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
    await fs.writeFile(filePath, content);

    const matches: SearchMatch[] = [
      {
        path: 'test.txt',
        line: 50,
        column: 1,
        matchText: 'Line 50',
        lineText: 'Line 50',
        score: 1,
      },
    ];

    const snippets = await extractor.extractSnippets(matches, {
      cwd: tmpDir,
      windowSize: 2,
    });

    expect(snippets).toHaveLength(1);
    const snippet = snippets[0];
    expect(snippet.path).toBe('test.txt');
    expect(snippet.startLine).toBe(48); // 50 - 2
    expect(snippet.endLine).toBe(52); // 50 + 2
    expect(snippet.content).toContain('Line 48');
    expect(snippet.content).toContain('Line 50');
    expect(snippet.content).toContain('Line 52');
  });

  it('merges overlapping windows', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    const content = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
    await fs.writeFile(filePath, content);

    const matches: SearchMatch[] = [
      { path: 'test.txt', line: 10, column: 1, matchText: 'Line 10', lineText: 'Line 10', score: 1 },
      { path: 'test.txt', line: 12, column: 1, matchText: 'Line 12', lineText: 'Line 12', score: 1 },
    ];

    const snippets = await extractor.extractSnippets(matches, {
      cwd: tmpDir,
      windowSize: 2,
    });

    expect(snippets).toHaveLength(1);
    const snippet = snippets[0];
    // Match 1: 8-12
    // Match 2: 10-14
    // Merge: 8-14
    expect(snippet.startLine).toBe(8);
    expect(snippet.endLine).toBe(14);
  });

  it('truncates long snippets', async () => {
    const filePath = path.join(tmpDir, 'long.txt');
    const longLine = 'a'.repeat(2000);
    await fs.writeFile(filePath, longLine);

    const matches: SearchMatch[] = [
      { path: 'long.txt', line: 1, column: 1, matchText: 'a', lineText: longLine, score: 1 },
    ];

    const snippets = await extractor.extractSnippets(matches, {
      cwd: tmpDir,
      maxSnippetChars: 100,
    });

    expect(snippets).toHaveLength(1);
    expect(snippets[0].content.length).toBeLessThanOrEqual(100 + 16); // content + newline + ... (truncated)
    expect(snippets[0].content).toContain('(truncated)');
  });
});
