export interface Embedder {
    embedTexts(texts: string[], opts?: object): Promise<number[][]>;
    dims(): number;
    id(): string;
}
//# sourceMappingURL=embedder.d.ts.map