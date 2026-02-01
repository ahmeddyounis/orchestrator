# Hardening Guide

This guide provides a step-by-step checklist to configure the Orchestrator CLI for maximum security. It's designed for users operating in sensitive environments or on untrusted codebases.

Each step links to the corresponding section in the [Threat Model & Safety Baseline](./security.md) for more details.

## Phase 1: Configuration Hardening

Apply these settings in your `.orchestrator/config.yaml` to establish a strong security baseline.

- [ ] **Disable Automatic Tool Execution:** Ensure all tool executions require manual confirmation. This is the single most important control to prevent unintended actions.
  ```yaml
  # .orchestrator/config.yaml
  tools:
    l2:
      shell:
        confirm: true # Default is true, but be explicit
      file:
        confirm: true # Default is true, but be explicit
  ```

- [ ] **Deny Network Access:** Block the agent from making any network requests by default. If specific domains are required for a task, create a temporary, scoped configuration file.
  ```yaml
  # .orchestrator/config.yaml
  security:
    networkPolicy: 'deny' # 'deny' | 'allow'
  ```

- [ ] **Disable Long-Term Memory:** Prevent the agent from persisting embeddings of your code and conversations, which could be a data exfiltration risk if the memory store is compromised.
  ```yaml
  # .orchestrator/config.yaml
  memory:
    enabled: false
  ```

- [ ] **Restrict Environment Variable Access:** Do not allow the agent to access any environment variables unless absolutely necessary. Maintain an explicit, minimal allowlist.
  ```yaml
  # .orchestrator/config.yaml
  security:
    env:
      allow: [] # Explicitly empty
  ```

- [ ] **Review External Adapters:** Be aware of the risks associated with any third-party CLI adapters. Only use trusted, well-vetted adapters. See the [External Adapters Threat Model](./security.md#5-malicious-external-adapters).

## Phase 2: Operational Security

Adopt these practices in your daily workflow to minimize risk.

- [ ] **Run in an Isolated Environment:** For untrusted or public repositories, run the CLI inside a container (e.g., Docker) or a virtual machine to isolate its access to your host system.

- [ ] **Regularly Wipe Memory:** If you use the memory feature, periodically delete the memory database (`.orchestrator/memory.sqlite`) to remove sensitive context from past sessions, especially when switching between unrelated projects.

- [ ] **Use Scoped, Ephemeral API Keys:** Generate unique API keys for the Orchestrator and grant them only the permissions they need. Rotate these keys regularly and avoid using long-lived, broadly-scoped keys from your primary accounts.

- [ ] **Use a `.geminiignore` File:** Add a `.geminiignore` file to your project root to explicitly prevent the agent from accessing sensitive files and directories, even for one-off context queries. This complements `.gitignore`.
  ```
  # .geminiignore
  .env
  .secrets/
  *.pem
  ```

## Recommended Safe Monorepo Configuration

Here is a complete, recommended safe-by-default configuration for a TypeScript monorepo.

```yaml
# .orchestrator/config.yaml

# Disable long-term memory to prevent code/conversation persistence.
memory:
  enabled: false

# Enforce confirmation for all high-risk tool operations.
tools:
  l2:
    shell:
      confirm: true
    file:
      confirm: true

# Default to denying all network access.
# For specific tasks requiring network, use a scoped config:
# gemini -c safe-net.yaml "Update dependencies"
security:
  networkPolicy: 'deny'
  # Explicitly deny access to environment variables.
  env:
    allow: []

# Optional: Configure file ignoring patterns for your monorepo.
# By default, .gitignore is respected. You can add more here.
context:
  ignore:
    - "**/node_modules/**"
    - "**/dist/**"
    - "**/.turbo/**"

# Recommended for monorepos to improve context quality.
providers:
  # Use a model with a large context window.
  # Ensure your adapter configuration is secure.
  default:
    adapter: "gemini" # or another trusted adapter
    model: "gemini-1.5-pro-latest"
```
