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
}
