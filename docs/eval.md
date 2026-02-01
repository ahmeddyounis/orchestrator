# Evaluation

The Orchestrator includes a powerful evaluation harness that lets you test its performance on a set of predefined tasks. This is useful for tracking improvements over time and comparing different models.

## Running an Evaluation

To run an evaluation, use the `eval` command and point it to a "suite" file.

```bash
orchestrator eval --suite <path-to-your-suite.json>
```

The orchestrator comes with a default suite to get you started.

## How it Works

An evaluation consists of a "suite" of "tasks".

- **Suite**: A JSON file that defines a collection of tasks.
- **Task**: A single test case for the orchestrator. Each task has:
  - A **fixture**: A small, self-contained code project representing the "before" state.
  - A **goal**: A natural language prompt for the orchestrator to execute (e.g., "Fix the bug in `index.js`").
  - **Success criteria**: A set of conditions to check if the task was completed successfully.

For each task, the evaluation harness will:

1.  Copy the fixture to a temporary directory.
2.  Run the orchestrator with the specified goal.
3.  Check the success criteria to see if the orchestrator passed the test.

## Authoring a Suite

You can create your own suites to test the orchestrator's performance on tasks that are relevant to your projects.

### Suite Schema

A suite is a JSON file with a `name` and a list of `tasks`.

```json
{
  "name": "My Custom Suite",
  "tasks": [
    {
      "id": "my-first-task",
      "repo": {
        "fixturePath": "path/to/my/fixture"
      },
      "goal": "Add a function to add two numbers",
      "successCriteria": [
        {
          "name": "file_contains",
          "details": {
            "path": "index.js",
            "substring": "function add(a, b)"
          }
        }
      ]
    }
  ]
}
```

### Key Fields

- `"id"`: A unique name for your task.
- `"fixturePath"`: The path to the directory containing the starting code for the task.
- `"goal"`: The prompt to give the orchestrator.
- `"successCriteria"`: The conditions for success.

### Success Criteria

You can use several types of criteria to check for success:

- `"file_contains"`: Checks if a file contains a specific string.
  - `"path"`: The file to check.
  - `"substring"`: The string to look for.
- `"script_exit"`: Runs a command and checks its exit code.
  - `"command"`: The command to run (e.g., `pnpm test`).
  - `"expectedCode"`: The expected exit code (usually `0`).
- `"verification_pass"`: Checks if the orchestrator's built-in verification step passed.

## Interpreting Results

After an evaluation run, a `summary.json` file is created in the `.orchestrator/eval/` directory. This file contains a high-level summary of the results, including the pass rate and other metrics.

By running evaluations regularly, you can track the orchestrator's performance and ensure that it continues to meet your quality standards.
