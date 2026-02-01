import { SubprocessProviderAdapter } from '../subprocess';
import { ProviderConfig, ModelRequest, ModelResponse } from '@orchestrator/shared';
import { AdapterContext } from '../types';
export declare class ClaudeCodeAdapter extends SubprocessProviderAdapter {
    constructor(config: ProviderConfig);
    id(): string;
    protected isPrompt(text: string): boolean;
    generate(req: ModelRequest, ctx: AdapterContext): Promise<ModelResponse>;
}
//# sourceMappingURL=adapter.d.ts.map