# Memory

The Orchestrator can remember information from past runs to improve its performance and provide more contextually aware assistance.

## How it Works

When memory is enabled, the orchestrator saves details about each run to a local file in your project's `.orchestrator` directory. This includes:

- The initial task description.
- The files that were changed.
- The commands that were run.
- The final outcome of the run.

On subsequent runs, the orchestrator will use this information to better understand your project and your goals.

## Enabling Memory

You can enable memory in two ways:

1.  **With a command-line flag:**

    Add the `--memory` flag to any `run` command:

    ```bash
    orchestrator run "Add a new component" --memory
    ```

2.  **In your configuration file:**

    Set `"enabled": true` in the `memory` section of your `.orchestrator/config.json`:

    ```json
    {
      "memory": {
        "enabled": true
      }
    }
    ```

    With this setting, memory will be enabled for all runs without needing the command-line flag.

## Example: A Memory-Enabled "Warm Start"

Memory is particularly useful for iterative development. Let's say you're working on a new feature and need to make several changes.

---

### Run 1: Scaffolding the Feature

First, you ask the orchestrator to create the basic files for a new feature.

```bash
orchestrator run "Scaffold a new 'UserProfile' feature. It should have a React component, a connected data-fetching hook, and a basic test file." --memory
```

The orchestrator creates `UserProfile.tsx`, `useUserProfile.ts`, and `UserProfile.test.tsx`. The memory now contains the knowledge that these files are related to the "UserProfile" feature.

---

### Run 2: Adding to the Feature

Now, you can make a follow-up request using a "warm start". The orchestrator already has context.

```bash
orchestrator run "Flesh out the component to display the user's name and email. Also, add a test for the data-fetching hook." --memory
```

Because the orchestrator remembers the previous run, it knows which files to edit. It will add the rendering logic to `UserProfile.tsx` and the new test to `UserProfile.test.tsx` without you needing to specify the file paths again.

This "warm start" capability makes iterative development much faster and more natural.

---

## Privacy

Your memory data is stored locally in your project directory and is never sent to any remote server. It is completely private to you and your project.

## Wiping Memory

If you want to clear the orchestrator's memory for a project, you can delete the memory file:

```bash
rm .orchestrator/memory.sqlite
```
