// packages/memory/src/vector/index.ts

export {
  VectorBackendContext,
  VectorItemMetadata,
  VectorUpsertItem,
  VectorQueryResult,
  VectorQueryFilters,
  VectorBackendInfo,
  VectorMemoryBackend,
} from "./backend";

export {
  VectorBackendFactory,
  VectorBackendConfig,
  MockVectorMemoryBackend,
  VectorBackendNotImplementedError,
  RemoteBackendNotAllowedError,
} from "./factory";
