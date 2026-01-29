import { describe, it, expect, beforeEach } from 'vitest';
import { SimpleContextPacker } from './packer';
import { Snippet } from '../snippets/types';
import { ContextPackerOptions, ContextSignal } from './types';

describe('SimpleContextPacker', () => {
  let packer: SimpleContextPacker;

  beforeEach(() => {
    packer = new SimpleContextPacker();
  });

  const createSnippet = (
    path: string,
    content: string,
    score: number,
    id: string
  ): Snippet => ({
    path,
    startLine: 1,
    endLine: 2,
    content,
    reason: `Test ${id}`,
    score,
  });

  it('should pack snippets within budget', () => {
    const snippets = [
      createSnippet('a.ts', 'short', 10, 'A'), // density 2
      createSnippet('b.ts', 'longcontent', 5, 'B'), // density < 0.5
    ];
    const options: ContextPackerOptions = { tokenBudget: 100, charsPerToken: 1 }; // budget 100 chars

    const result = packer.pack('goal', [], snippets, options);

    expect(result.items).toHaveLength(2);
    expect(result.totalChars).toBe(16);
  });

  it('should exclude items exceeding budget based on density', () => {
    const snippets = [
      createSnippet('a.ts', 'aaaaa', 10, 'A'), // len 5, score 10, dens 2
      createSnippet('b.ts', 'bbbbb', 20, 'B'), // len 5, score 20, dens 4
      createSnippet('c.ts', 'ccccc', 5, 'C'), // len 5, score 5, dens 1
    ];
    // Budget 12 chars. Should pick B (5), then A (5). C (5) would make 15 > 12.
    const options: ContextPackerOptions = { tokenBudget: 12, charsPerToken: 1 };

    const result = packer.pack('goal', [], snippets, options);

    expect(result.items.map(i => i.reason)).toEqual(expect.arrayContaining(['Test B', 'Test A']));
    expect(result.items).toHaveLength(2);
    expect(result.totalChars).toBe(10);
  });

  it('should respect maxItemsPerFile', () => {
    const snippets = [
      createSnippet('a.ts', 'a1', 100, 'A1'),
      createSnippet('a.ts', 'a2', 90, 'A2'),
      createSnippet('a.ts', 'a3', 80, 'A3'),
      createSnippet('b.ts', 'b1', 10, 'B1'),
    ];
    const options: ContextPackerOptions = {
        tokenBudget: 1000,
        charsPerToken: 1,
        maxItemsPerFile: 2
    };

    const result = packer.pack('goal', [], snippets, options);

    const aItems = result.items.filter(i => i.path === 'a.ts');
    expect(aItems).toHaveLength(2);
    expect(result.items.find(i => i.path === 'b.ts')).toBeDefined();
    // A1 and A2 are highest score.
    expect(aItems.map(i => i.reason)).toContain('Test A1');
    expect(aItems.map(i => i.reason)).toContain('Test A2');
  });

  it('should respect minFiles diversity', () => {
    // A: 1 item, high score
    // B: 1 item, med score
    // C: 1 item, low score
    // D: 1 item, very low score
    // But we want minFiles=3.
    // Actually minFiles logic in my impl: "Pick best snippet from top K files".
    // If I have 3 files, and budget allows, it picks 1 from each.
    
    // Let's construct a scenario where greedy would fail diversity.
    // File A has 5 snippets with score 100.
    // File B has 1 snippet with score 10.
    // File C has 1 snippet with score 10.
    // Budget allows 4 items.
    // Greedy would pick 4 from A.
    // Diversity (minFiles=3) should pick 1 from A, 1 from B, 1 from C.
    // Then 1 more from A (since A's remaining are high score).
    
    const snippets = [
      createSnippet('a.ts', 'a1', 100, 'A1'),
      createSnippet('a.ts', 'a2', 100, 'A2'),
      createSnippet('a.ts', 'a3', 100, 'A3'),
      createSnippet('a.ts', 'a4', 100, 'A4'),
      createSnippet('b.ts', 'b1', 10, 'B1'),
      createSnippet('c.ts', 'c1', 10, 'C1'),
    ];
    
    const options: ContextPackerOptions = {
        tokenBudget: 1000,
        charsPerToken: 1,
        minFiles: 3
    };

    const result = packer.pack('goal', [], snippets, options);

    const paths = result.items.map(i => i.path);
    expect(paths).toContain('b.ts');
    expect(paths).toContain('c.ts');
    
    // We expect B1 and C1 to be present.
    // And remaining spots filled by A.
    // Total items should be all 6 (budget is huge).
    expect(result.items).toHaveLength(6);
    
    // Restrict budget to test prioritization
    // Budget = 4 items * 2 chars = 8 chars.
    const optionsTight = { ...options, tokenBudget: 8, charsPerToken: 1 };
    const resultTight = packer.pack('goal', [], snippets, optionsTight);
    
    // Should have 1 from A, 1 from B, 1 from C (to satisfy minFiles=3)
    // Then 1 more from A.
    const pathsTight = resultTight.items.map(i => i.path);
    expect(pathsTight).toContain('b.ts');
    expect(pathsTight).toContain('c.ts');
    expect(pathsTight.filter(p => p === 'a.ts').length).toBeGreaterThanOrEqual(1);
    expect(resultTight.items.length).toBeLessThanOrEqual(4);
  });
  
  it('should boost scores with signals', () => {
    const snippets = [
      createSnippet('a.ts', 'a', 10, 'A'),
      createSnippet('b.ts', 'b', 10, 'B'),
    ];
    
    // Signal boosts B
    const signals: ContextSignal[] = [{ type: 'file_change', data: 'b.ts', weight: 10 }];
    const options: ContextPackerOptions = { tokenBudget: 100, charsPerToken: 1 };
    
    const result = packer.pack('goal', signals, snippets, options);
    
    const itemB = result.items.find(i => i.path === 'b.ts');
    expect(itemB).toBeDefined();
    expect(itemB?.score).toBe(100); // 10 * 10
    expect(itemB?.reason).toContain('Boosted by file_change');
  });

  it('should handle large items exceeding budget', () => {
    const snippets = [
      createSnippet('a.ts', 'small', 10, 'A'),
      createSnippet('b.ts', 'huge_content_exceeding_budget', 100, 'B'),
    ];
    const options: ContextPackerOptions = { tokenBudget: 5, charsPerToken: 1 };
    
    const result = packer.pack('goal', [], snippets, options);
    
    expect(result.items).toHaveLength(1);
    expect(result.items[0].path).toBe('a.ts');
  });
});
