import { Config } from '@orchestrator/shared';
import { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import { EventBus } from '../registry';
export declare class PlanService {
    private eventBus;
    constructor(eventBus: EventBus);
    generatePlan(goal: string, providers: {
        planner: ProviderAdapter;
    }, ctx: AdapterContext, artifactsDir: string, repoRoot: string, config?: Config): Promise<string[]>;
}
//# sourceMappingURL=service.d.ts.map