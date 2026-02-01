import { SemanticChunk } from '../types';

export interface SemanticHit extends SemanticChunk {
  score: number;
}
