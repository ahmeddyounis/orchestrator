import fs from 'fs/promises';
import path from 'path';

export interface PlanExecutionStep {
  id?: string;
  step: string;
  ancestors: string[];
}

export async function readPlanExecutionSteps(
  artifactsRoot: string,
  fallbackSteps: string[],
): Promise<PlanExecutionStep[]> {
  const planPath = path.join(artifactsRoot, 'plan.json');
  try {
    const raw = await fs.readFile(planPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('plan.json is not an object');
    }

    const record = parsed as Record<string, unknown>;
    const execution = record.execution;
    if (Array.isArray(execution)) {
      const result: PlanExecutionStep[] = [];
      for (const entry of execution) {
        if (!entry || typeof entry !== 'object') continue;
        const step = (entry as Record<string, unknown>).step;
        if (typeof step !== 'string' || step.trim().length === 0) continue;

        const id = (entry as Record<string, unknown>).id;
        const ancestorsRaw = (entry as Record<string, unknown>).ancestors;
        const ancestors = Array.isArray(ancestorsRaw)
          ? ancestorsRaw
              .map(String)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

        result.push({
          id: typeof id === 'string' && id.trim().length > 0 ? id : undefined,
          step: step.trim(),
          ancestors,
        });
      }
      if (result.length > 0) return result;
    }
  } catch {
    // ignore and fall back
  }

  return fallbackSteps.map((step, i) => ({
    id: String(i + 1),
    step,
    ancestors: [],
  }));
}
