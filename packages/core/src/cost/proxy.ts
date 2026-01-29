import { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import {
  ModelRequest,
  ModelResponse,
  ProviderCapabilities,
  StreamEvent,
} from '@orchestrator/shared';
import { CostTracker } from './tracker';

export class CostTrackingAdapter implements ProviderAdapter {
  constructor(
    private providerId: string,
    private adapter: ProviderAdapter,
    private tracker: CostTracker,
  ) {}

  id(): string {
    return this.adapter.id();
  }

  capabilities(): ProviderCapabilities {
    return this.adapter.capabilities();
  }

  async generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse> {
    const response = await this.adapter.generate(req, ctx);
    if (response.usage) {
      this.tracker.recordUsage(this.providerId, response.usage);
    }
    return response;
  }

  async *stream(req: ModelRequest, ctx: AdapterContext): AsyncIterable<StreamEvent> {
    if (!this.adapter.stream) return;

    for await (const event of this.adapter.stream(req, ctx)) {
      if (event.type === 'usage') {
        this.tracker.recordUsage(this.providerId, event.usage);
      }
      yield event;
    }
  }
}
