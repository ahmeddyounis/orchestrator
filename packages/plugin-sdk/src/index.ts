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
  type LoadPluginOptions,
} from './loader';

// Permission exports
export {
  permissions,
  PermissionManifestBuilder,
  validatePermissionManifest,
  checkPermissions,
  DEFAULT_UNTRUSTED_PERMISSIONS,
  DEFAULT_TRUSTED_PERMISSIONS,
  type PluginPermissions,
  type PermissionManifest,
} from './permissions';

// Security exports
export {
  generateSigningKeyPair,
  signPlugin,
  verifyPluginSecurity,
  addTrustedKey,
  DEFAULT_SECURITY_CONTEXT,
  DEV_SECURITY_CONTEXT,
  type PluginSecurityContext,
  type SecurePluginManifest,
  type SignedPluginBundle,
} from './security';

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
