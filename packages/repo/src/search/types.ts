export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  matchText: string;
  lineText: string;
  score?: number;
}

export interface SearchOptions {
  query: string;
  /**
   * Root directory to search in.
   */
  cwd: string;
  /**
   * Max matches per file to return.
   * Default: 10
   */
  maxMatchesPerFile?: number;
  /**
   * Target package/directory hint for ranking boost.
   */
  targetDir?: string;
  /**
   * If true, performs a fixed string search instead of regex.
   * Default: false (regex)
   */
  fixedStrings?: boolean;
}

export interface SearchResult {
  matches: SearchMatch[];
  stats: {
    durationMs: number;
    filesSearched?: number; // Approximate in rg case
    matchesFound: number;
    engine: 'ripgrep' | 'js-fallback';
  };
}

export interface SearchEngine {
  search(options: SearchOptions): Promise<SearchResult>;
  isAvailable(): Promise<boolean>;
}
