import { Snippet } from '../snippets/types';

export interface ContextItem {
  path: string;
  startLine: number;
  endLine: number;
  content: string;
  reason: string;
  score: number;
}

export interface ContextPack {
  items: ContextItem[];
  totalChars: number;
  estimatedTokens: number;
}

export interface ContextSignal {
  type: 'error' | 'file_change' | 'package_focus';
  data: unknown; // e.g., stack trace or file path
  weight?: number; // Optional multiplier for scoring
}

export interface ContextPackerOptions {
  tokenBudget: number;
  charsPerToken?: number; // Default 4
  minFiles?: number; // Diversity goal, e.g. 3
  maxItemsPerFile?: number; // Diversity constraint
}

export interface ContextPacker {
  pack(
    goal: string,
    signals: ContextSignal[],
    candidateSnippets: Snippet[],
    options: ContextPackerOptions
  ): ContextPack;
}
