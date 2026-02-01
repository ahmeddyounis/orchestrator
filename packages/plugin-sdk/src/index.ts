/**
 * @orchestrator/plugin-sdk
 *
 * Plugin SDK for building orchestrator extensions.
 * Provides stable interfaces for providers, embedders, vector backends, and tool executors.
 */

// Version exports
export {
  SDK_VERSION,
  isVersionCompatible,
  getVersionMismatchError,
  type SdkVersionRange,
} from './version';

// Interface exports
export type {
  // Common types
  PluginConfig,
  PluginContext,
  HealthCheckResult,
  // Lifecycle
  PluginLifecycle,
  // Provider
  ProviderAdapterPlugin,
  // Embedder
  EmbedderPlugin,
  // Vector
  VectorMetadata,
  VectorItem,
  VectorQueryResult,
  VectorQueryFilter,
  VectorBackendInfo,
  VectorMemoryBackendPlugin,
  // Tool
  ToolExecutorPlugin,
  // Manifest
  PluginType,
  PluginManifest,
  PluginExport,
} from './interfaces';

// Loader exports
export {
  loadPlugin,
  safeLoadPlugin,
  validateManifest,
  PluginValidationError,
  PluginVersionMismatchError,
  type LoadPluginResult,
} from './loader';

// Re-export commonly used types from shared for convenience
export type {
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  StreamEvent,
  ChatMessage,
  ToolSpec,
  ToolCall,
  Usage,
  ToolRunRequest,
  ToolRunResult,
  ToolPolicy,
} from '@orchestrator/shared';

// Re-export Logger from interfaces (handles the sync/async ambiguity)
export type { Logger } from './interfaces';
