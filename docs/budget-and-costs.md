# Budget and Cost Tracking

This document describes the orchestrator's budget management system, cost estimation model,
and how to monitor and control resource usage during orchestration runs.

## Overview

The orchestrator provides multiple mechanisms to control resource consumption:

1. **Cost budgets** - Limit spending based on estimated API costs
2. **Iteration budgets** - Limit the number of LLM interaction cycles
3. **Tool run budgets** - Limit the number of tool executions
4. **Wall time budgets** - Limit total elapsed time

Budget enforcement happens at the start of each iteration, providing a fail-safe
against runaway costs while allowing in-progress work to complete.

## Budget Configuration

### CLI Flags

Use the `--budget` flag with comma-separated key=value pairs:

```bash
# Set a $5 cost limit and 6 iteration limit
orchestrator run "Add feature X" --budget cost=5,iter=6

# Set all budget types
orchestrator run "Fix bug Y" --budget cost=10,iter=8,tool=20,time=30m
```

### Budget Keys

| Key    | Description                     | Default | Example Values                   |
| ------ | ------------------------------- | ------- | -------------------------------- |
| `cost` | Maximum estimated cost in USD   | None    | `cost=5`, `cost=0.50`            |
| `iter` | Maximum LLM iteration cycles    | 4       | `iter=6`, `iter=10`              |
| `tool` | Maximum tool/command executions | 6       | `tool=10`, `tool=20`             |
| `time` | Maximum wall clock time         | 10m     | `time=5m`, `time=1h`, `time=30s` |

### Time Format

The `time` budget supports multiple units:

- `ms` - milliseconds (e.g., `time=500ms`)
- `s` - seconds (e.g., `time=30s`)
- `m` - minutes (e.g., `time=20m`)
- `h` - hours (e.g., `time=1h`)
- No unit defaults to milliseconds (e.g., `time=60000`)

### Configuration File

Budget defaults can also be set in `.orchestrator.yaml`:

```yaml
configVersion: 1

budget:
  cost: 10 # $10 maximum
  iter: 8 # 8 iterations maximum
  tool: 15 # 15 tool runs maximum
  time: 1200000 # 20 minutes in milliseconds
```

CLI flags override configuration file values.

## Cost Estimation Model

### How Costs Are Calculated

The orchestrator estimates costs using a token-based pricing model:

```
estimated_cost = (input_tokens / 1,000,000) × input_price_per_mtok
               + (output_tokens / 1,000,000) × output_price_per_mtok
```

Costs are tracked **per provider** and aggregated for the total run cost.

### Configuring Provider Pricing

Pricing information is configured per provider in your configuration:

```yaml
providers:
  openai:
    type: openai
    model: gpt-4o
    api_key_env: OPENAI_API_KEY
    pricing:
      inputPerMTokUsd: 2.50 # $2.50 per million input tokens
      outputPerMTokUsd: 10.00 # $10.00 per million output tokens

  anthropic:
    type: anthropic
    model: claude-3-5-sonnet-20240620
    api_key_env: ANTHROPIC_API_KEY
    pricing:
      inputPerMTokUsd: 3.00
      outputPerMTokUsd: 15.00

  # Subprocess providers (claude_code, codex_cli, etc.) may not report
  # token usage consistently - cost tracking may be unavailable
  claude_code:
    type: claude_code
    model: claude-code
    command: claude
    # pricing: not configured - costs will show as null
```

### Accuracy Considerations

**Important**: Cost estimates are approximations with several limitations:

1. **Token counts depend on provider reporting**
   - API providers (OpenAI, Anthropic) report accurate token counts
   - Subprocess providers may not report usage at all
   - Some providers only report output tokens, not input tokens

2. **Pricing may be outdated**
   - Provider pricing changes over time
   - You are responsible for keeping `pricing` values current
   - The orchestrator does not fetch live pricing data

3. **Estimates may differ from actual bills**
   - Providers may use different tokenization than reported
   - Cached responses, prompt caching, or batching may reduce actual costs
   - Some providers have minimum charges or rounding

4. **Cost tracking is best-effort**
   - If a provider doesn't report usage, cost shows as `null`
   - Mixed providers may have partial cost visibility
   - Budget enforcement treats unknown costs as $0 (conservative)

### When Cost Is Unknown

The cost tracker returns `null` for `estimatedCostUsd` when:

- No pricing is configured for the provider
- The provider doesn't report token usage
- An error occurred during usage collection

For budget enforcement, unknown costs are treated as $0. This means:

- Runs with unconfigured pricing won't hit cost limits
- Use iteration/tool/time budgets as backstops for subprocess providers

## Budget Enforcement

### Enforcement Points

Budgets are checked at the **start of each iteration**, not continuously:

1. Before planning/execution begins
2. After each tool execution
3. Before starting a new iteration cycle

This means a single iteration can exceed the budget before enforcement kicks in.

### Enforcement Behavior

When a budget limit is exceeded:

1. A `BudgetExceededError` is thrown
2. The current operation completes (no mid-operation abort)
3. The run terminates with the budget error
4. Partial results are preserved in the run artifacts

### Example: Iteration Budget

```
Budget: iter=4

Iteration 1: Plan generated ✓
Iteration 2: Code generated, tests run ✓
Iteration 3: Bug fix applied ✓
Iteration 4: Verification passed ✓
Iteration 5: Budget check → BudgetExceededError!
```

### Example: Cost Budget

```
Budget: cost=1.00

Iteration 1: $0.15 spent, total: $0.15 ✓
Iteration 2: $0.25 spent, total: $0.40 ✓
Iteration 3: $0.45 spent, total: $0.85 ✓
Iteration 4: $0.30 spent, total: $1.15 → BudgetExceededError!
```

Note: The final iteration pushed the total over $1.00, but the budget
was only enforced after the iteration completed.

## Monitoring Costs

### Run Summary

After each run, the summary includes cost information:

```
Run completed successfully.

Cost Summary:
  openai:     $1.23 (input: 450,000 tokens, output: 12,500 tokens)
  anthropic:  $0.45 (input: 120,000 tokens, output: 3,200 tokens)
  ─────────────────
  Total:      $1.68
```

### Programmatic Access

The `CostTracker` class provides programmatic access to cost data:

```typescript
import { CostTracker } from '@orchestrator/core';

const tracker = new CostTracker(config);

// Record usage (done automatically by the orchestrator)
tracker.recordUsage('openai', {
  inputTokens: 1500,
  outputTokens: 200,
  totalTokens: 1700,
});

// Get summary
const summary = tracker.getSummary();
console.log(summary);
// {
//   providers: {
//     openai: {
//       inputTokens: 1500,
//       outputTokens: 200,
//       totalTokens: 1700,
//       estimatedCostUsd: 0.0058  // or null if no pricing
//     }
//   },
//   total: {
//     inputTokens: 1500,
//     outputTokens: 200,
//     totalTokens: 1700,
//     estimatedCostUsd: 0.0058
//   }
// }
```

### Run Artifacts

Cost data is persisted in run artifacts at `.orchestrator/runs/<runId>/`:

- `summary.json` - Contains cost summary for the run
- `trace.jsonl` - Contains per-iteration cost events

## Best Practices

### 1. Always Set Multiple Budget Types

```bash
# Good: Multiple safeguards
orchestrator run "task" --budget cost=5,iter=10,time=30m

# Risky: Only cost limit (subprocess providers may not report costs)
orchestrator run "task" --budget cost=5
```

### 2. Configure Pricing for API Providers

Add pricing configuration for accurate cost tracking:

```yaml
providers:
  openai:
    type: openai
    model: gpt-4o
    pricing:
      inputPerMTokUsd: 2.50
      outputPerMTokUsd: 10.00
```

### 3. Use Iteration Limits for Subprocess Providers

Subprocess providers (claude_code, codex_cli, gemini_cli) often don't report
token usage. Rely on iteration and time limits instead:

```bash
orchestrator run "task" --budget iter=5,time=20m
```

### 4. Start Conservative, Increase as Needed

Begin with lower budgets and increase based on task complexity:

```bash
# Simple tasks
orchestrator run "fix typo" --budget cost=1,iter=3

# Complex refactoring
orchestrator run "refactor auth" --budget cost=20,iter=15,time=1h
```

### 5. Monitor Costs Across Runs

Review cost summaries regularly to calibrate your budgets:

```bash
# View last run summary
orchestrator report

# Export run data for analysis
orchestrator export-bundle --runs 10 --output costs.zip
```

## Reference Pricing (as of 2024)

These are example prices for reference. **Always verify current pricing
with your provider.**

| Provider | Model | Input $/MTok | Output $/MTok |
