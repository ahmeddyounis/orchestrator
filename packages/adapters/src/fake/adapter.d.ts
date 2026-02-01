import { ProviderAdapter } from '../adapter';
import { AdapterContext } from '../types';
import {
  ProviderCapabilities,
  ModelRequest,
  ModelResponse,
  ProviderConfig,
} from '@orchestrator/shared';
export declare class FakeAdapter implements ProviderAdapter {
  private config;
  constructor(config: ProviderConfig);
  id(): string;
  capabilities(): ProviderCapabilities;
  generate(request: ModelRequest, context: AdapterContext): Promise<ModelResponse>;
}
//# sourceMappingURL=adapter.d.ts.map
