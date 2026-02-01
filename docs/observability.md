# Observability: Reports and Artifacts

The Orchestrator is designed to be transparent. For every run, it produces detailed logs and reports so you can understand exactly what it did.

## Run Artifacts

After each run, the orchestrator saves a collection of "artifacts" to a new directory in your project:

**Path**: `.orchestrator/runs/<run_id>/`

Each `run_id` is a unique timestamp. This directory is your single source of truth for a run.

### What's Inside?

-   **`summary.json`**: A high-level summary of the run, including the final status, duration, and how much it cost (in tokens and dollars).
-   **`diff.patch`**: A standard `.patch` file showing all the code changes that were made. You can use this to easily review the changes.
-   **`trace.jsonl`**: A detailed, low-level log of every single event that happened during the run. This is useful for deep debugging.
-   **`tool_logs/`**: A directory containing the `stdout` and `stderr` output from any shell commands that were run (like tests or linting).

## The `report` Command

The easiest way to understand a run is to use the `report` command.

### Reporting on the Last Run

To see a summary of the most recent run, simply type:

```bash
orchestrator report
```

### Reporting on a Specific Run

If you want to view a report for an older run, you can pass the `run_id`:

```bash
orchestrator report <run_id>
```

### What the Report Shows

The report provides a clean, human-readable summary of the run, including:

-   **Status**: Did the run complete successfully, fail, or does it need review?
-   **Duration**: How long the run took.
-   **Cost**: A breakdown of the cost based on the number of tokens used.
-   **Changed Files**: A list of all the files that were created or modified.
-   **Errors**: If anything went wrong, the errors will be displayed here.

## Example: Debugging a Failed Test

Let's say the orchestrator runs and tells you that verification failed. Here's how you can use the artifacts to debug it:

1.  **Run the report**:
    ```bash
    orchestrator report
    ```
    The report shows that the `pnpm test` command failed.

2.  **Find the `run_id`**: The report will show the `run_id`. Let's say it's `171234567890`.

3.  **Check the tool logs**:
    Navigate to the tool logs directory for that run:
    `.orchestrator/runs/171234567890/tool_logs/`

    Inside, you'll find files like `pnpm-test-stdout.log` and `pnpm-test-stderr.log`.

4.  **Examine the logs**:
    Open the `pnpm-test-stderr.log` file. It will contain the exact error message from the test runner, showing you which test failed and why.