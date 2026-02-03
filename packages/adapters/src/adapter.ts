import {
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  StreamEvent,
} from '@orchestrator/shared';
import { AdapterContext } from './types';

export interface ProviderAdapter {
  id(): string;
  capabilities(): ProviderCapabilities;
  generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse>;
  stream?(req: ModelRequest, ctx: AdapterContext): AsyncIterable<StreamEvent>;
  /**
   * Returns capabilities for validation purposes without full instantiation.
   * This static-like method allows config validation before adapter creation.
   * Adapters that require runtime info for capabilities can return base capabilities.
   */
}

/**
 * Static capabilities getter for pre-instantiation validation.
 */
export type AdapterCapabilitiesGetter = () => ProviderCapabilities;
}
