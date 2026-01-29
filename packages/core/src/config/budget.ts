import { Config } from '@orchestrator/shared';

type Budget = NonNullable<Config['budget']>;

export function parseBudget(input: string): Budget {
  const parts = input.split(',');
  const budget: Budget = {};

  for (const part of parts) {
    const [key, valStr] = part.split('=');
    if (!key || !valStr) {
       throw new Error(`Invalid budget format: ${part}. Expected key=value.`);
    }

    const cleanKey = key.trim();
    const cleanVal = valStr.trim();

    if (cleanKey === 'time') {
      budget.time = parseDuration(cleanVal);
    } else if (cleanKey === 'cost') {
      const val = parseFloat(cleanVal);
      if (isNaN(val)) throw new Error(`Invalid cost value: ${cleanVal}`);
      budget.cost = val;
    } else if (cleanKey === 'iter') {
        const val = parseInt(cleanVal, 10);
        if (isNaN(val)) throw new Error(`Invalid iter value: ${cleanVal}`);
        budget.iter = val;
    } else if (cleanKey === 'tool') {
        const val = parseInt(cleanVal, 10);
        if (isNaN(val)) throw new Error(`Invalid tool value: ${cleanVal}`);
        budget.tool = val;
    } else {
        throw new Error(`Unknown budget key: ${cleanKey}`);
    }
  }
  return budget;
}

function parseDuration(input: string): number {
  const match = input.match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${input}. Expected number with optional unit (ms, s, m, h).`);
  }
  const value = parseInt(match[1], 10);
  const unit = match[2] || 'ms';

  switch (unit) {
    case 'ms': return value;
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default: return value;
  }
}

export const DEFAULT_BUDGET: Budget = {
    iter: 4,
    tool: 6,
    time: 10 * 60 * 1000, // 10m
};
