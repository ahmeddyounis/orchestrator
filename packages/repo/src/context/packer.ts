import { Snippet } from '../snippets/types';
import { normalizePath } from '@orchestrator/shared';
import {
  ContextPacker,
  ContextPack,
  ContextPackerOptions,
  ContextSignal,
  ContextItem,
} from './types';

const PATH_LIKE_RE = /(?:[A-Za-z]:)?[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,10}/g;

function normalizeSignalPath(input: string): string {
  let p = normalizePath(String(input ?? '').trim());
  // Strip common "path:line:col" suffixes.
  p = p.replace(/\((\d+,\d+)\)$/, '');
  p = p.replace(/:(\d+)(?::(\d+))?$/, '');
  return p;
}

function extractPathHintsFromSignalData(data: unknown): string[] {
  const out: string[] = [];
  const add = (p: string) => {
    const normalized = normalizeSignalPath(p);
    if (!normalized) return;
    out.push(normalized);
  };

  if (!data) return [];

  if (typeof data === 'string') {
    const matches = data.match(PATH_LIKE_RE) ?? [];
    for (const m of matches) add(m);
    return out;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string') add(item);
    }
    return out;
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.path === 'string') add(obj.path);
    if (typeof obj.file === 'string') add(obj.file);
    if (typeof obj.stack === 'string') {
      const matches = obj.stack.match(PATH_LIKE_RE) ?? [];
      for (const m of matches) add(m);
    }
    if (Array.isArray(obj.paths)) {
      for (const p of obj.paths) {
        if (typeof p === 'string') add(p);
      }
    }
    if (Array.isArray(obj.files)) {
      for (const f of obj.files) {
        if (typeof f === 'string') add(f);
      }
    }
  }

  return out;
}

function matchesPathHint(snippetPath: string, hint: string): boolean {
  const s = normalizePath(snippetPath);
  const h = normalizePath(hint);
  if (!h) return false;

  if (s === h) return true;
  if (s.endsWith(h)) return true;
  if (h.endsWith(s)) return true;

  // If we only have a basename-like hint, match on basename.
  if (!h.includes('/')) {
    const sBase = s.split('/').pop();
    return sBase === h;
  }

  return false;
}

export class SimpleContextPacker implements ContextPacker {
  pack(
    goal: string,
    signals: ContextSignal[],
    candidateSnippets: Snippet[],
    options: ContextPackerOptions,
  ): ContextPack {
    const charsPerToken = options.charsPerToken || 4;
    const charBudget = options.tokenBudget * charsPerToken;
    const minFiles = options.minFiles || 0;
    const maxItemsPerFile = options.maxItemsPerFile || Infinity;

    const errorPathCache = new WeakMap<ContextSignal, string[]>();

    // 1. Adjust scores based on signals
    const scoredCandidates = candidateSnippets.map((snippet) => {
      let score = snippet.score;
      let reason = snippet.reason;

      for (const signal of signals) {
        if (this.matchesSignal(snippet, signal, errorPathCache)) {
          const weight = signal.weight || 1.5;
          score *= weight;
          reason += ` (Boosted by ${signal.type})`;
        }
      }

      return { ...snippet, score, reason };
    });

    // 2. Filter out items that are too big on their own
    const candidates = scoredCandidates.filter((s) => s.content.length <= charBudget);

    const selectedItems: ContextItem[] = [];
    const usedSnippetIndices = new Set<number>();
    let currentTotalChars = 0;
    const itemsByFile = new Map<string, number>();

    // Helper to add item
    const addItem = (snippet: Snippet, index: number) => {
      selectedItems.push({
        path: snippet.path,
        startLine: snippet.startLine,
        endLine: snippet.endLine,
        content: snippet.content,
        reason: snippet.reason,
        score: snippet.score,
      });
      usedSnippetIndices.add(index);
      currentTotalChars += snippet.content.length;
      itemsByFile.set(snippet.path, (itemsByFile.get(snippet.path) || 0) + 1);
    };

    // 3. Diversity Pass: Try to pick best snippet from top K files
    if (minFiles > 0) {
      // Group by file
      const fileGroups = new Map<string, { snippet: Snippet; index: number }[]>();
      candidates.forEach((s, i) => {
        if (!fileGroups.has(s.path)) fileGroups.set(s.path, []);
        fileGroups.get(s.path)!.push({ snippet: s, index: i });
      });

      // Sort files by their *best* snippet's score
      const sortedFiles = Array.from(fileGroups.entries()).sort(([, aSnippets], [, bSnippets]) => {
        const maxA = Math.max(...aSnippets.map((x) => x.snippet.score));
        const maxB = Math.max(...bSnippets.map((x) => x.snippet.score));
        return maxB - maxA;
      });

      // Take top `minFiles` files
      const topFiles = sortedFiles.slice(0, minFiles);

      for (const [, snippets] of topFiles) {
        // Pick best snippet from this file
        const best = snippets.reduce((prev, curr) =>
          curr.snippet.score > prev.snippet.score ? curr : prev,
        );

        if (currentTotalChars + best.snippet.content.length <= charBudget) {
          addItem(best.snippet, best.index);
        }
      }
    }

    // 4. Greedy Pass: Fill remaining budget with highest density items
    // Density = Score / Size.  Higher is better.
    const remainingCandidates = candidates
      .map((s, i) => ({ snippet: s, index: i }))
      .filter(({ index }) => !usedSnippetIndices.has(index));

    remainingCandidates.sort((a, b) => {
      const densityA = a.snippet.score / (a.snippet.content.length || 1);
      const densityB = b.snippet.score / (b.snippet.content.length || 1);
      return densityB - densityA;
    });

    for (const { snippet, index } of remainingCandidates) {
      if (currentTotalChars + snippet.content.length > charBudget) {
        continue;
      }

      const fileCount = itemsByFile.get(snippet.path) || 0;
      if (fileCount >= maxItemsPerFile) {
        continue;
      }

      addItem(snippet, index);
    }

    return {
      items: selectedItems,
      totalChars: currentTotalChars,
      estimatedTokens: Math.ceil(currentTotalChars / charsPerToken),
    };
  }

  private matchesSignal(
    snippet: Snippet,
    signal: ContextSignal,
    errorPathCache: WeakMap<ContextSignal, string[]>,
  ): boolean {
    if (signal.type === 'file_change' || signal.type === 'package_focus') {
      // Simple string containment for path
      // Assuming signal.data is a string (filepath or package name)
      if (typeof signal.data === 'string' && snippet.path.includes(signal.data)) {
        return true;
      }
    }

    if (signal.type === 'error') {
      if (!errorPathCache.has(signal)) {
        errorPathCache.set(signal, extractPathHintsFromSignalData(signal.data));
      }
      const hints = errorPathCache.get(signal) ?? [];
      for (const hint of hints) {
        if (matchesPathHint(snippet.path, hint)) return true;
      }
    }

    return false;
  }
}
