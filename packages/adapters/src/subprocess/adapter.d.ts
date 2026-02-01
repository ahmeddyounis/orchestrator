import { ProviderAdapter } from '../adapter';
import { ModelRequest, ModelResponse, ProviderCapabilities } from '@orchestrator/shared';
import { AdapterContext } from '../types';
import { SubprocessCompatibilityProfiles } from './compatibility';
export interface SubprocessConfig {
    command: string[];
    cwdMode?: 'repoRoot' | 'runDir';
    envAllowlist?: string[];
    maxTranscriptSize?: number;
    compatibilityProfile?: keyof typeof SubprocessCompatibilityProfiles;
}
export declare class SubprocessProviderAdapter implements ProviderAdapter {
    private config;
    private compatibilityProfile;
    constructor(config: SubprocessConfig);
    id(): string;
    capabilities(): ProviderCapabilities;
    /**
     * Detects if a chunk of text from a subprocess indicates it is idle and waiting for a prompt.
     * @param text The text to inspect.
     * @returns True if the text is a prompt marker.
     */
    protected isPrompt(text: string): boolean;
    generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse>;
}
//# sourceMappingURL=adapter.d.ts.map