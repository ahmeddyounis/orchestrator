# Evaluation Harness

The Orchestrator includes an evaluation harness (`eval`) to measure and track the performance of the agent on a set of predefined tasks. This guide explains how to use the harness, author evaluation suites, and interpret the results.

## Running an Evaluation

To run an evaluation, use the `eval` command with the path to your suite file:

```bash
pnpm orchestrator eval <path-to-your-suite.json>
```

### Options

- `--baseline <name>`: Run the suite against a named baseline configuration (e.g., a different model or provider) for comparison. Baselines are defined in `packages/eval/src/baselines.json`.
- `--out <dir>`: Specify a directory to store the evaluation results. Defaults to `.orchestrator/eval` in the repository root.
- `--json`: Output the final summary as JSON to standard output.

### Example

```bash
# Run the example suite
pnpm orchestrator eval packages/eval/src/__fixtures__/test-suite.json

# Run against a baseline and store results in a custom directory
pnpm orchestrator eval packages/eval/src/__fixtures__/test-suite.json --baseline gpt-4 --out ./eval_results
```

## Suite File Schema

Evaluation suites are defined in JSON files. Here is an overview of the schema:

```json
{
  "schemaVersion": 1,
  "name": "my-awesome-suite",
  "tasks": [
    {
      "id": "task-1",
      "title": "A descriptive title for the task",
      "repo": {
        "fixturePath": "path/to/the/fixture-repo"
      },
      "goal": "The user prompt for the agent to execute",
      "command": "run",
      "thinkLevel": "L1",
      "successCriteria": [
        {
          "name": "criterion-name",
          "details": {
            "key": "value"
          }
        }
      ]
    }
  ]
}
```

- `schemaVersion` (number, required): The version of the suite schema. Currently `1`.
- `name` (string, required): The name of the suite. Used for reporting.
- `tasks` (array, required): A list of tasks for the agent to perform.

### Task Object

- `id` (string, required): A unique identifier for the task within the suite.
- `title` (string, required): A human-readable title for the task.
- `repo` (object, required): Specifies the code repository context for the task.
  - `fixturePath` (string, required): The path to a directory containing the code for the task. The harness will copy this directory into a temporary location and initialize a git repository before running the task.
- `goal` (string, required): The natural language prompt that will be given to the agent.
- `command` (string, required): The orchestrator command to run. Currently, only `"run"` is supported.
- `thinkLevel` (string, optional): The thinking level for the agent (`L0`, `L1`, `L2`, `auto`). Defaults to `L1`.
- `successCriteria` (array, required): A list of conditions that must be met for the task to be considered successful.

### Success Criteria

The `successCriteria` array defines how to verify the agent's work.

- `name` (string, required): The name of the criterion.
- `details` (object, optional): A set of parameters for the criterion.

Available criteria:

- **`file_contains`**: Checks if a file contains a specific substring.
  - `path`: The path to the file (relative to the fixture root).
  - `substring`: The content to search for.
- **`script_exit`**: Runs a script and checks its exit code.
  - `command`: The command to execute.
  - `expectedCode`: The expected exit code (defaults to `0`).
- **`verification_pass`**: Checks if the Orchestrator's own verification step passed. This is useful for tasks that involve code changes that should pass tests or linting.

## Authoring a New Task

To add a new evaluation task:

1.  **Create a Fixture Repository**:
    - Create a new directory that represents the state of a project _before_ the agent runs. For a TypeScript monorepo, this would include `package.json`, `tsconfig.json`, and relevant source files.
    - Place it in a logical location, for example, under `packages/eval/src/__fixtures__/my-new-task-repo`.

2.  **Define the Task in a Suite**:
    - Open an existing suite file (like `packages/eval/src/__fixtures__/test-suite.json`) or create a new one.
    - Add a new task object to the `tasks` array.
    - Set the `fixturePath` to point to the directory you created.
    - Write a clear `goal` for the agent.
    - Define at least one `successCriterion` to automatically verify the outcome.

### Minimal Suite Example

Here is a minimal example of a suite with one task.

**`my-suite.json`**:

```json
{
  "schemaVersion": 1,
  "name": "hello-world-suite",
  "tasks": [
    {
      "id": "create-file",
      "title": "Create a file with content",
      "repo": {
        "fixturePath": "packages/eval/src/__fixtures__/empty-repo"
      },
      "goal": "Create a new file named 'hello.txt' containing the text 'hello world'",
      "command": "run",
      "thinkLevel": "L1",
      "successCriteria": [
        {
          "name": "file_contains",
          "details": {
            "path": "hello.txt",
            "substring": "hello world"
          }
        }
      ]
    }
  ]
}
```

You would also need to create the `packages/eval/src/__fixtures__/empty-repo` directory (it can be empty).

## Interpreting Results

After an evaluation run, the output directory (e.g., `.orchestrator/eval/<suite-name>/<timestamp>/`) will contain several result files:

- **`summary.json`**: A high-level overview of the run, including aggregate metrics and the final status (`PASS` or `FAIL`).
- **`results_orchestrator.json`**: The detailed results for the main orchestrator run. It contains a breakdown for each task, including status, duration, metrics (cost, tokens), and artifacts produced.
- **`results_baseline.json`** (if `--baseline` was used): The detailed results for the baseline run, in the same format as the orchestrator results.
- **`comparison.json`** (if `--baseline` was used): A comparison of key aggregate metrics between the orchestrator and the baseline, showing deltas for pass rate, duration, and cost.

These files allow you to track performance over time, identify regressions when changes are made, and compare the effectiveness of different models or agent configurations.

## Safety Notes

The evaluation harness executes agent-generated commands on your machine. To mitigate risks:

- **Denylist**: The underlying tool execution mechanism has a denylist for dangerous commands (e.g., `rm -rf /`).
- **Network Policy**: No specific network policies are enforced by the harness itself. The agent has the potential to make network requests.
- **Fixture Scoping**: Tasks operate on temporary copies of fixture repositories, so the original fixture code is not modified. However, generated code could still attempt to access files outside the temporary directory.

Always review the `goal` and generated commands for new or unfamiliar tasks before running them.
