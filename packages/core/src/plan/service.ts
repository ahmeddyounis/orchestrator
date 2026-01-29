import { ModelRequest } from '@orchestrator/shared';
import { ProviderAdapter, AdapterContext } from '@orchestrator/adapters';
import { EventBus } from '../registry';

export class PlanService {
  constructor(private eventBus: EventBus) {}

  async generatePlan(
    goal: string,
    providers: { planner: ProviderAdapter },
    ctx: AdapterContext,
  ): Promise<string[]> {
    await this.eventBus.emit({
      type: 'PlanRequested',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      payload: { goal },
    });

    const systemPrompt = `You are an expert software architecture planner.
Your goal is to break down a high-level user goal into a sequence of clear, actionable steps.
Return ONLY a JSON object with a "steps" property containing an array of strings.
Each step should be a concise instruction.`;

    const userPrompt = `Goal: ${goal}`;

    const request: ModelRequest = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      jsonMode: true,
    };

    const response = await providers.planner.generate(request, ctx);

    if (!response.text) {
      throw new Error('Planner provider returned empty response');
    }

    let planSteps: string[];
    try {
      // Basic cleanup for markdown code blocks if the model includes them despite jsonMode
      const cleanedText = response.text.replace(/```json\n|\n```/g, '').trim();

      const parsed = JSON.parse(cleanedText);
      if (parsed && Array.isArray(parsed.steps)) {
        planSteps = parsed.steps.map(String);
      } else if (Array.isArray(parsed)) {
        // Fallback if model returns just array
        planSteps = parsed.map(String);
      } else {
        throw new Error('Response does not contain "steps" array');
      }
    } catch (e) {
      // We throw the error up, caller handles logging
      throw new Error(
        `Failed to parse planner response: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    await this.eventBus.emit({
      type: 'PlanCreated',
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: ctx.runId,
      payload: { planSteps },
    });

    return planSteps;
  }
}
