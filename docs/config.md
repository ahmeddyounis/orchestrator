# Configuration Reference

Orchestrator configuration is YAML and is validated on startup.

## Where config lives

Orchestrator loads configuration from these locations (higher wins):

1. **CLI flags** (e.g. `--think L2`, `--budget cost=5,iter=6`)
2. **Explicit config file** via `--config <path>`
3. **Repo config** at `<repoRoot>/.orchestrator.yaml`
4. **User config** at `~/.orchestrator/config.yaml`
5. **Built-in defaults**

`orchestrator init` creates a starter `.orchestrator.yaml`.

## Minimal working config

```yaml
configVersion: 1

defaults:
  planner: openai
  executor: openai

providers:
  openai:
    type: openai
    model: gpt-4o-mini
    api_key_env: OPENAI_API_KEY
```

## Providers

`providers` is a map of provider **IDs** to provider configuration. Provider IDs are what you reference in `defaults`.

Each provider must include:

- `type`: one of `openai`, `anthropic`, `claude_code`, `gemini_cli`, `codex_cli`, `fake`
- `model`: a string (adapter-specific; required by config validation)

Hosted providers typically use one of:

- `api_key_env`: environment variable name containing the key (recommended)
- `api_key`: inline key (not recommended for repo config)

Example with multiple providers:

```yaml
providers:
  openai:
    type: openai
    model: gpt-4o-mini
    api_key_env: OPENAI_API_KEY

  anthropic:
    type: anthropic
    model: claude-3-5-sonnet-20240620
    api_key_env: ANTHROPIC_API_KEY

  claude_code:
    type: claude_code
    model: claude-code
    command: claude
    args: []
    # Optional: Increase/decrease the subprocess timeout (ms).
    # timeoutMs: 600000
    # Allowlisted env vars forwarded to the subprocess (optional).
    env:
      - ANTHROPIC_API_KEY

  gemini_cli:
    type: gemini_cli
    model: gemini-2.5-flash
    command: gemini
    args: []

  codex_cli:
    type: codex_cli
    model: o3-mini
    command: codex
    args: []
```

## Defaults

`defaults` selects which configured provider IDs are used for each role:

```yaml
defaults:
  planner: openai
  executor: openai
  reviewer: anthropic
```

## Think level

```yaml
thinkLevel: L2 # L0 | L1 | L2 | L3
```

## Planning (nested plans + review)

You can optionally expand each plan step into a deeper, multi-step plan, and/or run a review pass over generated plans.

```yaml
planning:
  # Maximum nesting depth for plan expansion.
  # - 1: outline only (default)
  # - 2+: expand each step into substeps recursively
  maxDepth: 1

  # Max substeps generated per expanded step.
  maxSubstepsPerStep: 6

  # Safety limit for total plan nodes (outline + all expanded substeps).
  maxTotalSteps: 200

  # Optional plan review pass.
  review:
    enabled: false
    # If enabled and the reviewer returns revisedSteps, apply them before expansion.
    apply: false
```

## Tool policy and sandbox

```yaml
execution:
  tools:
    enabled: true
    requireConfirmation: true
    # Network is denied by default; allow only when needed.
    networkPolicy: deny
  sandbox:
    mode: none # none | docker | devcontainer
```

## Memory

```yaml
memory:
  enabled: true
  retrieval:
    mode: hybrid # lexical | vector | hybrid
    topKLexical: 8
    topKVector: 8
  vector:
    enabled: false
```

For a deeper dive, see `docs/memory.md` and `docs/memory-vector.md`.
