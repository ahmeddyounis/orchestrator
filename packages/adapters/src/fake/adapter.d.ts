import { ProviderAdapter, ProviderCapabilities, GenerateRequest, GenerateResponse, AdapterContext } from '@orchestrator/adapters';
import { ProviderConfig } from '@orchestrator/shared';
export declare class FakeAdapter implements ProviderAdapter {
    private config;
    constructor(config: ProviderConfig);
    id(): string;
    capabilities(): ProviderCapabilities;
    generate(request: GenerateRequest, context: AdapterContext): Promise<GenerateResponse>;
}
//# sourceMappingURL=adapter.d.ts.map