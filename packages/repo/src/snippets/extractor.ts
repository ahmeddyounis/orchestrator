import fs from 'node:fs/promises';
import path from 'node:path';
import { SearchMatch } from '../search/types';
import { Snippet, ExtractSnippetsOptions } from './types';

interface Window {
  start: number;
  end: number;
  matches: SearchMatch[];
}

export class SnippetExtractor {
  async extractSnippets(
    matches: SearchMatch[],
    options: ExtractSnippetsOptions
  ): Promise<Snippet[]> {
    const {
      cwd,
      windowSize = 15,
      maxSnippetChars = 1000,
      maxSnippetsPerFile = 5,
    } = options;

    const snippets: Snippet[] = [];
    const matchesByFile = new Map<string, SearchMatch[]>();

    // Group matches by file
    for (const match of matches) {
      if (!matchesByFile.has(match.path)) {
        matchesByFile.set(match.path, []);
      }
      matchesByFile.get(match.path)!.push(match);
    }

    // Process each file
    for (const [filePath, fileMatches] of matchesByFile.entries()) {
      const absPath = path.resolve(cwd, filePath);
      let content: string;
      let lines: string[];

      try {
        content = await fs.readFile(absPath, 'utf-8');
        lines = content.split('\n');
      } catch {
        // Skip file if read fails
        continue;
      }

      // Calculate windows
      const windows: Window[] = [];

      for (const match of fileMatches) {
        const line = match.line; // 1-based
        const start = Math.max(1, line - windowSize);
        const end = Math.min(lines.length, line + windowSize);

        windows.push({
          start,
          end,
          matches: [match],
        });
      }

      // Merge overlapping or adjacent windows
      // Sort by start line
      windows.sort((a, b) => a.start - b.start);

      const mergedWindows: Window[] = [];
      if (windows.length > 0) {
        let currentWindow = windows[0];

        for (let i = 1; i < windows.length; i++) {
          const nextWindow = windows[i];

          // Check overlap or adjacency (e.g. end 20 and start 21 should merge)
          if (nextWindow.start <= currentWindow.end + 1) {
            currentWindow.end = Math.max(currentWindow.end, nextWindow.end);
            currentWindow.matches.push(...nextWindow.matches);
          } else {
            mergedWindows.push(currentWindow);
            currentWindow = nextWindow;
          }
        }
        mergedWindows.push(currentWindow);
      }

      // Limit snippets per file (prioritize highest scoring windows?)
      // For now, simple logic: sort by score desc then take top N, then sort by line asc
      const windowsWithScore = mergedWindows.map((w) => {
        const maxScore = Math.max(...w.matches.map((m) => m.score || 0));
        return { ...w, maxScore };
      });

      windowsWithScore.sort((a, b) => b.maxScore - a.maxScore);
      const selectedWindows = windowsWithScore.slice(0, maxSnippetsPerFile);
      // Restore line order
      selectedWindows.sort((a, b) => a.start - b.start);

      // Create snippets
      for (const w of selectedWindows) {
        // Extract content
        // lines array is 0-based, so start-1 to end
        const snippetLines = lines.slice(w.start - 1, w.end);
        let snippetContent = snippetLines.join('\n');

        snippetContent = this.redact(snippetContent);

        // Truncate if too long
        if (snippetContent.length > maxSnippetChars) {
          snippetContent = snippetContent.slice(0, maxSnippetChars) + '\n... (truncated)';
        }

        snippets.push({
          path: filePath,
          startLine: w.start,
          endLine: w.end,
          content: snippetContent,
          reason: 'search-match',
          score: w.maxScore,
        });
      }
    }

    return snippets;
  }

  private redact(content: string): string {
    // Stub: implement redaction logic here (e.g. secret scanning)
    return content;
  }
}
