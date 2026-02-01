import type { MemoryEntry } from '../types';
import type { RetrievalIntent } from '@orchestrator/shared';
export interface RerankOptions {
  intent: RetrievalIntent;
  staleDownrank: boolean;
  failureSignature?: string;
}
export declare function rerank(entries: MemoryEntry[], options: RerankOptions): MemoryEntry[];
//# sourceMappingURL=reranker.d.ts.map
