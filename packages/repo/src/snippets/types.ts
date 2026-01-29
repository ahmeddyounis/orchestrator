export interface Snippet {
  path: string;
  startLine: number; // 1-based
  endLine: number; // 1-based
  content: string;
  reason: string;
  score: number;
}

export interface ExtractSnippetsOptions {
  /**
   * Root directory to resolve relative paths in matches.
   */
  cwd: string;

  /**
   * Number of lines of context before and after the match line.
   * Default: 15
   */
  windowSize?: number;

  /**
   * Maximum characters allowed per snippet.
   * If exceeded, the snippet will be truncated.
   * Default: 1000
   */
  maxSnippetChars?: number;

  /**
   * Maximum number of snippets to return per file.
   * Default: 5
   */
  maxSnippetsPerFile?: number;
}
