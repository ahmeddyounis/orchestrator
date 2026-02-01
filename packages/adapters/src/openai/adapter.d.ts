import {
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  StreamEvent,
  ProviderConfig,
} from '@orchestrator/shared';
import { ProviderAdapter, AdapterContext } from '../index';
export declare class OpenAIAdapter implements ProviderAdapter {
  private client;
  private model;
  constructor(config: ProviderConfig);
  id(): string;
  capabilities(): ProviderCapabilities;
  generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse>;
  stream(req: ModelRequest, ctx: AdapterContext): AsyncIterable<StreamEvent>;
  private mapMessages;
  private mapTools;
  private mapError;
}
//# sourceMappingURL=adapter.d.ts.map
