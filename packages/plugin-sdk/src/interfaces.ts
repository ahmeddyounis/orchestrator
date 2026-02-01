/**
 * Plugin SDK Interfaces
 *
 * This module defines the core plugin interfaces that providers,
 * embedders, vector backends, and tool executors must implement.
 */

import type {
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  StreamEvent,
  Logger,
  ToolRunRequest,
  ToolRunResult,
  ToolPolicy,
} from '@orchestrator/shared';

import type { SdkVersionRange } from './version';

// Re-export Logger type (may be sync or async depending on implementation)
export type { Logger };

// ============================================================================
// Common Plugin Types
// ============================================================================

/**
 * Plugin configuration passed during initialization.
 * Plugins can define their own config shape extending this.
 */
export type PluginConfig = Record<string, unknown>;

/**
 * Context provided to plugins during operations.
 * Contains run-specific information and utilities.
 */
export interface PluginContext {
  runId: string;
  logger: Logger;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Health check result returned by plugins
 */
export interface HealthCheckResult {
  healthy: boolean;
  message?: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Plugin Lifecycle Interface
// ============================================================================

/**
 * Base interface for all plugins with lifecycle hooks.
 * All plugin types extend this interface.
 */
export interface PluginLifecycle {
  /**
   * Unique identifier for this plugin instance
   */
  readonly name: string;

  /**
   * SDK version range this plugin is compatible with
   */
  readonly sdkVersion: SdkVersionRange;

  /**
   * Initialize the plugin with configuration.
   * Called once when the plugin is loaded.
   */
  init(config: PluginConfig, ctx: PluginContext): Promise<void>;

  /**
   * Check if the plugin is healthy and operational.
   * Should be lightweight and safe to call frequently.
   */
  healthCheck(): Promise<HealthCheckResult>;

  /**
   * Clean up resources when the plugin is being unloaded.
   * Called once when shutting down.
   */
  shutdown(): Promise<void>;
}

// ============================================================================
// Provider Adapter Interface
// ============================================================================

/**
 * Interface for LLM provider adapters.
 * Implementations connect to specific LLM providers (OpenAI, Anthropic, etc.)
 */
export interface ProviderAdapterPlugin extends PluginLifecycle {
  /**
   * Provider-specific capabilities and features
   */
  capabilities(): ProviderCapabilities;

  /**
   * Generate a response from the LLM
   */
  generate(req: ModelRequest, ctx: PluginContext): Promise<ModelResponse>;

  /**
   * Stream responses from the LLM (optional)
   */
  stream?(req: ModelRequest, ctx: PluginContext): AsyncIterable<StreamEvent>;
}

// ============================================================================
// Embedder Interface
// ============================================================================

/**
 * Interface for embedding providers.
 * Implementations convert text to vector embeddings.
 */
export interface EmbedderPlugin extends PluginLifecycle {
  /**
   * Get the dimensionality of embeddings produced
   */
  dims(): number;

  /**
   * Generate embeddings for the given texts
   */
  embedTexts(
    texts: string[],
    ctx: PluginContext,
  ): Promise<number[][]>;
}

// ============================================================================
// Vector Memory Backend Interface
// ============================================================================

/**
 * Metadata stored alongside each vector
 */
export interface VectorMetadata {
  type: string;
  stale: boolean;
  updatedAt: number;
  embedderId?: string;
  dims?: number;
}

/**
 * A vector item to be stored or retrieved
 */
export interface VectorItem {
  id: string;
  vector: Float32Array;
  metadata: VectorMetadata;
}

/**
 * Result from a vector query
 */
export interface VectorQueryResult {
  id: string;
  score: number;
  metadata?: VectorMetadata;
}

/**
 * Filter options for vector queries
 */
export interface VectorQueryFilter {
  type?: string;
  stale?: boolean;
}

/**
 * Backend metadata information
 */
export interface VectorBackendInfo {
  backend: string;
  dims: number;
  embedderId: string;
  location: string;
  supportsFilters: boolean;
}

/**
 * Interface for vector memory backends.
 * Implementations store and query vector embeddings.
 */
export interface VectorMemoryBackendPlugin extends PluginLifecycle {
  /**
   * Insert or update vectors
   */
  upsert(repoId: string, items: VectorItem[], ctx: PluginContext): Promise<void>;

  /**
   * Query vectors by similarity, returning topK results sorted by score descending
   */
  query(
    repoId: string,
    vector: Float32Array,
    topK: number,
    ctx: PluginContext,
    filter?: VectorQueryFilter,
  ): Promise<VectorQueryResult[]>;

  /**
   * Delete specific vectors by their IDs
   */
  deleteByIds(repoId: string, ids: string[], ctx: PluginContext): Promise<void>;

  /**
   * Delete all vectors for a repository
   */
  wipeRepo(repoId: string, ctx: PluginContext): Promise<void>;

  /**
   * Get backend metadata
   */
  info(): Promise<VectorBackendInfo>;
}

// ============================================================================
// Tool Executor Interface
// ============================================================================

/**
 * Interface for tool/command executors.
 * Implementations run commands in sandboxed environments.
 */
export interface ToolExecutorPlugin extends PluginLifecycle {
  /**
   * Execute a tool/command request
   */
  execute(
    request: ToolRunRequest,
    policy: ToolPolicy,
    ctx: PluginContext,
  ): Promise<ToolRunResult>;

  /**
   * Check if a command is allowed by the policy (optional pre-check)
   */
  isAllowed?(command: string, policy: ToolPolicy): boolean;
}

// ============================================================================
// Plugin Manifest
// ============================================================================

/**
 * Plugin types supported by the SDK
 */
export type PluginType = 'provider' | 'embedder' | 'vector-backend' | 'tool-executor';

/**
 * Plugin manifest describing the plugin.
 * Used by the loader to discover and configure plugins.
 */
export interface PluginManifest {
  /**
   * Unique name of the plugin
   */
  name: string;

  /**
   * Human-readable description
   */
  description?: string;

  /**
   * Plugin type
   */
  type: PluginType;

  /**
   * SDK version range this plugin is compatible with
   */
  sdkVersion: SdkVersionRange;

  /**
   * Plugin version (semver)
   */
  version: string;

  /**
   * Configuration schema (optional, for validation)
   */
  configSchema?: Record<string, unknown>;
}

/**
 * Plugin module export shape.
 * Plugin packages should default export an object matching this interface.
 */
export interface PluginExport<T extends PluginLifecycle = PluginLifecycle> {
  manifest: PluginManifest;
  createPlugin: () => T;
}
