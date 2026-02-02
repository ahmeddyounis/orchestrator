# Orchestrator

Repo-aware agentic CLI for planning, patching, and verification.

## Quickstart

```bash
# Install the CLI
npm install -g @orchestrator/cli

# In your repo
orchestrator init
orchestrator doctor
orchestrator index build
orchestrator run "Fix the failing tests"
```

## Documentation

- `docs/quickstart.md`
- `docs/cli.md`
- `docs/config.md`
- `docs/verification.md`
- `docs/plugins.md`
- `docs/security.md`

## Development

```bash
pnpm install
pnpm check
pnpm --filter @orchestrator/cli test
```
