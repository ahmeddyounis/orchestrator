import {
  ProviderConfig,
  ProviderCapabilities,
  ModelRequest as GenerateRequest,
  ModelResponse as GenerateResponse,
} from '@orchestrator/shared';
import { ProviderAdapter } from '../adapter';
import { AdapterContext } from '../types';
export declare class FakeAdapter implements ProviderAdapter {
  private config;
  constructor(config: ProviderConfig);
  id(): string;
  capabilities(): ProviderCapabilities;
  generate(request: GenerateRequest, context: AdapterContext): Promise<GenerateResponse>;
}
//# sourceMappingURL=adapter.d.ts.map
