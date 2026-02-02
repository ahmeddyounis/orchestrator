# Quickstart

This guide will walk you through installing and running the Orchestrator on your TypeScript project. The Orchestrator is a CLI tool that helps you automate development tasks.

## Prerequisites

- Node.js v20+
- A TypeScript project (we'll use a `pnpm` monorepo in this guide)

## 1. Installation

Install the CLI package globally from npm:

```bash
npm install -g @orchestrator/cli
```

## 2. Configuration

Before you can run the orchestrator, you need to configure your API provider and other settings.

### Option A: Create a repo config (recommended)

From the root of your repository:

```bash
orchestrator init
```

This creates `.orchestrator.yaml` and guides you through next steps.

### Option B: Create a user config

Create `~/.orchestrator/config.yaml`:

```bash
mkdir -p ~/.orchestrator
cat > ~/.orchestrator/config.yaml <<'YAML'
configVersion: 1

defaults:
  planner: openai
  executor: openai

providers:
  openai:
    type: openai
    model: gpt-4o-mini
    api_key_env: OPENAI_API_KEY
YAML
```

Then set your API key:

```bash
export OPENAI_API_KEY="sk-..."
```

For more details, see the [Configuration Reference](config.md).

## 3. Indexing your Project

The orchestrator needs to build an index of your codebase to understand it.

Run the following command in the root of your project:

```bash
orchestrator index build
```

This command may take a few minutes, depending on the size of your project. It will analyze your files and create an index in the `.orchestrator/` directory of your project.

For more details on indexing, see the [Indexing Guide](indexing.md).

## 4. Your First Run: A Quick Fix

Let's use the orchestrator to fix a simple bug.

Imagine you have a bug where a function is missing a null check. You can ask the orchestrator to fix it.

```bash
orchestrator run "In 'packages/utils/src/string-helpers.ts', the 'formatName' function throws an error if the user object is null. Add a null check to return an empty string instead."
```

The orchestrator will:

1.  **Analyze the request** and your codebase.
2.  **Propose a code change** to fix the issue.
3.  **Ask for your confirmation** before applying the change.
4.  **Run tests** to verify that the fix works and doesn't introduce any new issues (if tests are configured).

This is a simple example, but it shows the power of the orchestrator to automate development tasks.

## Next Steps

Now that you've seen a basic workflow, explore the other documentation to learn more about what you can do:

- [CLI Reference](cli.md)
- [Configuration](config.md)
- [Verification](verification.md)
