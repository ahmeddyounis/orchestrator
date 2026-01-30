# Observability

The orchestrator is designed for transparency. It produces detailed artifacts for every run, allowing you to debug issues, analyze performance, and understand costs.

## Run Artifacts

For every run, the orchestrator creates a directory to store artifacts for reproducibility and debugging.

**Path**: `.orchestrator/runs/<run_id>/`

This directory is your primary source of truth for what happened during a run.

### Core Artifacts

- **`trace.jsonl`**: The complete, low-level event log for the run in [JSONL](https://jsonlines.org/) format. This is the most detailed record, capturing everything from tool calls to AI model interactions. It includes timing information for building performance traces.
- **`summary.json`**: A high-level summary of the run's outcome, duration, and token/cost metrics.
- **`manifest.json`**: A list of all files created or modified during the run, along with their SHA-256 hashes.
- **`diff.patch`**: A cumulative `diff` of all code changes applied during the run. This can be applied as a patch for review.
- **`tool_logs/`**: A directory containing raw `stdout` and `stderr` logs from tool executions.

### `trace.jsonl` Schema

Each line is a JSON object representing a span in a distributed trace.

- `schemaVersion`: `number` (Current: 1)
- `timestamp`: `string` (ISO 8601)
- `runId`: `string`
- `type`: `string` (Event Type, e.g., `RunStarted`, `ToolRun`, `LLMRequest`)
- `spanId`: `string` (Unique ID for this event)
- `parentSpanId`: `string | null` (The ID of the parent event)
- `details`: `object` (Payload specific to the event type)

Events form a hierarchy. For example, a `ToolRun` event would be a child of an `AgentStep` event.

### `summary.json` Schema

This file provides a quick overview of the run.

```json
{
  "runId": "string",
  "status": "string (e.g., 'completed', 'failed', 'needs_review')",
  "startTime": "string (ISO 8601)",
  "endTime": "string (ISO 8601)",
  "durationMs": "number",
  "cost": {
    "total": "number (in USD)",
    "breakdown": [
      {
        "provider": "string",
        "model": "string",
        "inputTokens": "number",
        "outputTokens": "number",
        "cost": "number"
      }
    ]
  },
  "tools": {
    "run": "number",
    "errors": "number"
  },
  "llmRequests": "number"
}
```
*Schema is illustrative and may be subject to minor changes.*

### `manifest.json` Schema

This file tracks every file touched by the orchestrator.

```json
[
  {
    "path": "string (relative to project root)",
    "status": "string (e.g., 'created', 'modified', 'deleted')",
    "hash": "string (SHA-256)"
  }
]
```

## Reporting

### CLI Report Command

The orchestrator includes a built-in command to generate reports from run artifacts.

```bash
# Generate a report for the last run
node packages/cli/dist/index.js report

# Generate a report for a specific run
node packages/cli/dist/index.js report --runId <run_id>
```

The report provides a summary of the run, including:
- Status and duration.
- A list of modified files.
- Cost and token usage.
- Errors and warnings.

### Cost Reporting

Cost is calculated based on token usage for each LLM provider. The pricing data is managed internally within the `@orchestrator/cost` package. When you run a report, it uses the `summary.json` artifact to display the total cost and a breakdown by provider and model.

This helps you monitor expenses and optimize your agent's configuration for cost-effectiveness.



## Example: Debugging a Failed Run in a Monorepo



Imagine the orchestrator fails during a `pnpm test` command in a large monorepo. Here’s how you’d investigate:



1.  **Find the Run ID**: Note the `runId` from the CLI output or find the latest directory in `.orchestrator/runs/`. Let's say it's `171234567890`.



2.  **Check the Summary**: Open `.orchestrator/runs/171234567890/summary.json`. You see `"status": "failed"`.



3.  **Use the Report Command**: For a quick overview of the error, run:

    ```bash

    node packages/cli/dist/index.js report --runId 171234567890

    ```

    The report shows a `ToolRun` error for the `pnpm test` command.



4.  **Inspect Tool Logs**: To see the raw output, navigate to the tool logs directory: `.orchestrator/runs/171234567890/tool_logs/`. Look for files corresponding to the failed tool call. You might find a file named `tool_1_pnpm_test_stderr.log`.



5.  **Examine the Log**: Open the log file. You'll see the full `stderr` output from `pnpm test`, revealing the exact test that failed and why.



6.  **Review the Trace**: For even deeper context, you can inspect `trace.jsonl`. Search for the `spanId` of the failed tool run to see the events that led up to it, such as the agent's reasoning and the exact parameters of the command.
