import { EventEmitter } from 'events';

type EventMap = {
  semanticIndexBuildStarted: { repoId: string };
  semanticIndexBuildFinished: {
    repoId: string;
    filesProcessed: number;
    chunksEmbedded: number;
    durationMs: number;
  };
  semanticIndexUpdateStarted: { repoId: string };
  semanticIndexUpdateFinished: {
    repoId: string;
    changedFiles: number;
    removedFiles: number;
    durationMs: number;
  };
};

class Emitter extends EventEmitter {
  emit<T extends keyof EventMap>(event: T, payload: EventMap[T]): boolean {
    return super.emit(event, payload);
  }

  on<T extends keyof EventMap>(event: T, listener: (payload: EventMap[T]) => void): this {
    return super.on(event, listener);
  }
}

export const emitter = new Emitter();
