export const name = '@orchestrator/shared';

export * from './types/events';
export * from './logger';
export * from './redaction';
export * from './errors';
export * from './fs/path';
export * from './fs/artifacts';
export * from './string-utils';
export * from './json-utils';
export * from './config/schema';
export * from './config/validation';
export * from './types/memory';
export * from './security';

export * from './types/llm';
export * from './types/patch';
export * from './types/tools';
export * from './types/config';
export * from './summary/summary';

export * from './observability';

export * from './eval';

export * from './config/schema';

// Re-export security types
export type { VectorRedactionOptions } from './security/secrets';
