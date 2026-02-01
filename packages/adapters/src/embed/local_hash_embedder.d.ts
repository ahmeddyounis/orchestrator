import { Embedder } from './embedder';
export declare class LocalHashEmbedder implements Embedder {
    private readonly dimensions;
    constructor(dimensions?: number);
    embedTexts(texts: string[]): Promise<number[][]>;
    dims(): number;
    id(): string;
    private l2Normalize;
}
//# sourceMappingURL=local_hash_embedder.d.ts.map