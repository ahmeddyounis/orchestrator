import { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import {
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  StreamEvent,
} from '@orchestrator/shared';
import { CostTracker } from './tracker';
export declare class CostTrackingAdapter implements ProviderAdapter {
  private providerId;
  private adapter;
  private tracker;
  constructor(providerId: string, adapter: ProviderAdapter, tracker: CostTracker);
  id(): string;
  capabilities(): ProviderCapabilities;
  generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse>;
  stream(req: ModelRequest, ctx: AdapterContext): AsyncIterable<StreamEvent>;
}
//# sourceMappingURL=proxy.d.ts.map
