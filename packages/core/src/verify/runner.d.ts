import { RunnerContext, UserInterface } from '@orchestrator/exec';
import { ProceduralMemory } from '@orchestrator/memory';
import { ToolPolicy } from '@orchestrator/shared';
import {
  VerificationReport,
  VerificationProfile,
  VerificationMode,
  VerificationScope,
} from './types';
import { EventBus } from '../registry';
export declare class VerificationRunner {
  private memory;
  private toolPolicy;
  private ui;
  private eventBus;
  private repoRoot;
  private runner;
  constructor(
    memory: ProceduralMemory,
    toolPolicy: ToolPolicy,
    ui: UserInterface,
    eventBus: EventBus,
    repoRoot: string,
  );
  run(
    profile: VerificationProfile,
    mode: VerificationMode,
    scope: VerificationScope,
    ctx: RunnerContext,
  ): Promise<VerificationReport>;
  private createCommandDetector;
  private getCommandsFromMemory;
  private saveCommandSources;
  private saveFailureSummary;
  private generateFailureSignature;
  private generateSummary;
}
//# sourceMappingURL=runner.d.ts.map
