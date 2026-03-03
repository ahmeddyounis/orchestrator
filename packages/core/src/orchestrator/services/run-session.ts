import type { RunInitializationService } from './initialization';
import type { ContextStackService, ContextStackSetupResult } from './context-stack';
import type { RunContext } from './types';

export interface RunSession {
  runContext: RunContext;
  contextStack: ContextStackSetupResult;
}

export async function createRunSession(args: {
  runId: string;
  goal: string;
  initService: RunInitializationService;
  contextStackService: ContextStackService;
}): Promise<RunSession> {
  const runContext = await args.initService.initializeRun(args.runId, args.goal);
  const contextStack = await args.contextStackService.setupForRun({
    runId: args.runId,
    artifactsRoot: runContext.artifacts.root,
    eventBus: runContext.eventBus,
  });

  return { runContext, contextStack };
}
