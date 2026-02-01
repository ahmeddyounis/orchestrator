export const name = '@orchestrator/shared';

export * from './types/events';
export * from './logger/jsonlLogger';
export * from './logger';
export * from './redaction';
export * from './errors';
export * from './fs/artifacts';
// NOTE: ./artifacts exports a different Manifest type; avoid re-export conflict.
export { ManifestManager, MANIFEST_FILENAME, MANIFEST_VERSION } from './artifacts';
export * from './config/schema';
export * from './types/memory';

export * from './types/llm';
export * from './types/patch';
export * from './types/tools';
export * from './types/config';
export * from './summary/summary';

export * from './observability';

export * from './eval';

export * from './config/schema';

