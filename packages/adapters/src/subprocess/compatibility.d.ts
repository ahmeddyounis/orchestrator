export type ParsingStrategy = 'marker' | 'fence' | 'heuristic';
export interface CompatibilityProfile {
    promptDetectionPattern: RegExp;
    initialPromptTimeoutMs: number;
    promptInactivityTimeoutMs: number;
    parsingStrategy?: ParsingStrategy;
}
export declare const DefaultCompatibilityProfile: CompatibilityProfile;
export declare const ClaudeCodeCompatibilityProfile: CompatibilityProfile;
export declare const SubprocessCompatibilityProfiles: {
    default: CompatibilityProfile;
    'claude-code': CompatibilityProfile;
};
//# sourceMappingURL=compatibility.d.ts.map