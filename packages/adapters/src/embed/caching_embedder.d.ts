import { Embedder } from './embedder';
export declare class CachingEmbedder implements Embedder {
    private readonly underlyingEmbedder;
    private cache;
    constructor(underlyingEmbedder: Embedder);
    embedTexts(texts: string[]): Promise<number[][]>;
    dims(): number;
    id(): string;
}
