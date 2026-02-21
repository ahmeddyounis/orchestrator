# Orchestrator

Repo-aware agentic CLI for planning, patching, and verification.

> Status: **alpha**. Expect breaking changes and keep confirmation prompts enabled until you’re confident in your setup.

## What it does

- Turns natural-language goals into reviewed patches across your repo
- Builds a local code index so it can find relevant files quickly
- Runs verification (lint/typecheck/tests) after applying changes (configurable)
- Supports multiple model “providers” (hosted APIs and local CLIs via adapters)

## Installation

Orchestrator is currently distributed as a packed tarball attached to GitHub Releases (npm publishing is planned).

- Download the latest `orchestrator-cli-*.tgz` from [Releases](https://github.com/ahmeddyounes/orchestrator/releases)
- Install it globally:

```bash
npm install -g ./orchestrator-cli-*.tgz
orchestrator --help
```

### Install from source (contributors)

```bash
pnpm install
pnpm --filter @orchestrator/cli build
npm install -g ./packages/cli
orchestrator --help
```

## Quickstart (in your repo)

Prerequisites:

- Node.js v20+
- `git`
- `rg` (ripgrep)
- (Windows) WSL is recommended

```bash
orchestrator init
export OPENAI_API_KEY="sk-..." # or configure another provider (see docs/config.md)
orchestrator doctor
orchestrator index build
orchestrator run "Fix the failing tests"
```

## Documentation

Start here:

- [Quickstart](docs/quickstart.md)
- [Configuration](docs/config.md)
- [CLI Reference](docs/cli.md)

Also useful:

- [Indexing](docs/indexing.md)
- [Verification](docs/verification.md)
- [Security](docs/security.md) and [Hardening](docs/hardening.md)
- [Plugins](docs/plugins.md)
- [Architecture](docs/architecture.md)

## Development

```bash
pnpm install
pnpm check
pnpm test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Support

- File bugs and feature requests in [GitHub Issues](https://github.com/ahmeddyounes/orchestrator/issues)
- When reporting a bug, consider attaching an `orchestrator export-bundle` zip (see `docs/support.md`)
