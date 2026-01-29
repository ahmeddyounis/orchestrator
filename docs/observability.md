# Observability

## Event Schema

The orchestrator uses a structured event logging system. All events are logged as JSON objects (JSONL format) with a standard envelope.

### Base Event

All events share these fields:

- `schemaVersion`: number (Current: 1)
- `timestamp`: string (ISO 8601)
- `runId`: string
- `type`: string (Event Type)

### Event Types

- **RunStarted**: Triggered when a new run begins.
- **PlanCreated**: Logged when the planner generates a new plan.
- **ContextBuilt**: Logged when context is gathered from files.
- **PatchProposed**: Logged when an agent proposes a code change.
- **PatchApplied**: Logged when a patch is successfully applied.
- **ToolRun**: Logged when a tool execution completes.
- **VerifyResult**: Logged when a verification command finishes.
- **RunFinished**: Logged when the run completes or fails.
- **MemoryWrite**: Logged when a fact is saved to long-term memory.

## Artifact Layout

For every run, the orchestrator creates a directory structure to store artifacts for reproducibility and debugging.

Path: `.orchestrator/runs/<run_id>/`

### Contents

- `trace.jsonl`: The complete event log for the run.
- `summary.json`: A high-level summary of the run (result, duration, etc.).
- `diff.patch`: The cumulative diff of changes applied during the run.
- `tool_logs/`: A directory containing raw output logs from tools if they produce separate log files.

## Usage

The `JsonlLogger` class in `@orchestrator/shared` is used to append events to `trace.jsonl`.
The `createRunArtifactsDir` helper ensures this structure exists before a run starts.
