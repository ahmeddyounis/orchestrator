import { ParsingStrategy } from './compatibility';
export interface DiffParsed {
    diffText: string;
    confidence: number;
}
export interface PlanParsed {
    steps: string[];
    confidence: number;
}
/**
 * Strips ANSI escape codes and normalizes line endings.
 */
export declare function sanitizeOutput(text: string): string;
/**
 * parses unified diff from text using multiple strategies:
 * 1. Explicit markers <BEGIN_DIFF>...</END_DIFF>
 * 2. Markdown code fences ```diff ... ```
 * 3. Heuristic scanning for unified diff headers
 */
export declare function parseUnifiedDiffFromText(text: string, strategy?: ParsingStrategy): DiffParsed | null;
/**
 * Parses a step-by-step plan from text.
 * Looks for numbered lists (1. ) or bullet points (- ) that look like steps.
 */
export declare function parsePlanFromText(text: string): PlanParsed | null;
//# sourceMappingURL=parsers.d.ts.map