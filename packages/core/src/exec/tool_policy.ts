import { ToolCall, ToolPolicy } from '@orchestrator/shared';

export class DenyAllToolPolicy implements ToolPolicy {
  isAllowed(toolCall: ToolCall): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export class AllowAllToolPolicy implements ToolPolicy {
  isAllowed(toolCall: ToolCall): Promise<boolean> {
    return Promise.resolve(true);
  }
}
