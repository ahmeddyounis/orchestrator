import {
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  StreamEvent,
} from '@orchestrator/shared';
import { AdapterContext } from './types';

/**
 * Interface for LLM provider adapters.
 * Adapters provide a unified interface for interacting with different LLM providers
 * (OpenAI, Anthropic, subprocess-based tools, etc.).
 *
 * @example
 * ```typescript
 * class MyAdapter implements ProviderAdapter {
 *   id() { return 'my-adapter'; }
 *   capabilities() { return { supportsStreaming: true, ... }; }
 *   async generate(req, ctx) { return { text: 'response' }; }
 * }
 * ```
 */
export interface ProviderAdapter {
  /**
   * Returns the unique identifier for this adapter instance.
   */
  id(): string;
  /**
   * Returns the capabilities of this provider.
   */
  capabilities(): ProviderCapabilities;
  /**
   * Generate a response from the model.
   * @param req - The model request containing messages and options
   * @param ctx - The adapter context with logger, abort signal, etc.
   * @returns The model response
   */
  generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse>;
  /**
   * Stream a response from the model (optional).
   * @param req - The model request containing messages and options
   * @param ctx - The adapter context with logger, abort signal, etc.
   * @returns An async iterable of stream events
   */
  stream?(req: ModelRequest, ctx: AdapterContext): AsyncIterable<StreamEvent>;
}

/**
 * Function type for getting adapter capabilities without full instantiation.
 * Used for pre-validation of configuration against adapter requirements.
 */
export type AdapterCapabilitiesGetter = () => ProviderCapabilities;
