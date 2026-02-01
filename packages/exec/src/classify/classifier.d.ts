import { ParsedCommand, ToolClassification } from './types';
export declare function matchesDenylist(raw: string, patterns: string[]): boolean;
export declare function matchesAllowlist(raw: string, prefixes: string[]): boolean;
export declare function classifyCommand(parsed: ParsedCommand): ToolClassification;
//# sourceMappingURL=classifier.d.ts.map
