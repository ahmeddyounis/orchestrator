export interface Embedder {
    embedTexts(texts: string[], opts?: object): Promise<number[][]>;
    dims(): number;
    id(): string;
}
