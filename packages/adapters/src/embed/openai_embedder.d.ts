import { Embedder } from './embedder';
export interface OpenAIEmbedderConfig {
    apiKey?: string;
    apiKeyEnv?: string;
    model?: string;
    dimensions?: number;
}
export declare class OpenAIEmbedder implements Embedder {
    private client;
    private model;
    private dimensions?;
    constructor(config: OpenAIEmbedderConfig);
    embedTexts(texts: string[]): Promise<number[][]>;
    dims(): number;
    id(): string;
    private mapError;
}
//# sourceMappingURL=openai_embedder.d.ts.map