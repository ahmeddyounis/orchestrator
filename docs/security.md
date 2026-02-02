# Threat Model & Safety Baseline

This document outlines the security posture for the Orchestrator CLI. It identifies key assets, potential threats, and the controls implemented to mitigate risks.

**For a step-by-step guide to applying these controls, see the [Hardening Guide](./hardening.md).**

## Assets

1.  **Repository Code:** The user's codebase, which may contain proprietary logic, secrets, or other sensitive data.
2.  **Secrets & Configuration:** API keys, environment variables, and configuration files on the user's machine.
3.  **User Machine:** The local file system and execution environment where the CLI runs.
4.  **Logs & Artifacts:** Execution logs and run artifacts, which might inadvertently capture sensitive data.
5.  **Memory Database:** The vector database storing embeddings of code and interactions, which could be targeted to reconstruct proprietary information.

## Threats

The primary threats involve the agent being manipulated into performing unintended actions or leaking sensitive data.

### 1. Prompt Injection

- **Description:** Malicious instructions embedded in the codebase (e.g., in a README, code comment, or dependency) that trick the LLM into executing unauthorized actions, such as writing malicious code or exfiltrating data.
- **Risk:** High. This is an active and unsolved research area. The primary mitigation is human-in-the-loop confirmation for all actions.

### 2. Secrets Exfiltration

- **Description:** The agent reading secrets from files (e.g., `.env`, `~/.aws/credentials`) or environment variables and sending them to the LLM provider, logging them to disk, or printing them to the console.
- **Risk:** High.

### 3. Destructive Tool Use

- **Description:** The agent using authorized tools like `shell` or `file` to perform destructive actions, such as `rm -rf /`, deleting source code, or corrupting project files.
- **Risk:** Critical.

### 4. Compromised Memory Persistence

- **Description:** An attacker gaining access to the local memory database (`.orchestrator/memory.sqlite`). While content can be encrypted, an attacker could analyze unencrypted vectors and metadata to infer information about the codebase or past activities.
- **Risk:** Medium.

### 5. Malicious External Adapters

- **Description:** The CLI's architecture allows for custom adapters to other CLIs or tools. A malicious or poorly secured adapter could introduce significant vulnerabilities, bypassing built-in controls. For example, an adapter could execute shell commands directly instead of using the Orchestrator's secured `shell` tool.
- **Risk:** High (if using untrusted adapters).

## Security Principles

1.  **Least Privilege:** The agent should only have access to the files, environment variables, and commands necessary for the task.
2.  **Explicit Confirmation:** High-risk actions (file writes, shell execution, network calls) require user approval by default. **This is the most important control.**
3.  **Local-First:** Data and logs are stored locally. Code is only sent to the configured LLM provider.
4.  **Defense in Depth:** Multiple layers of security (LLM prompting, application-level checks, user confirmation, and operational practices).

## Controls & Mitigations

### 1. Tool Confirmation & Policy

- **Confirmation by Default:** Tool execution can require confirmation before running commands (`execution.tools.requireConfirmation`).
- **Network Policy:** Tool network access is **denied by default** (`execution.tools.networkPolicy: deny`).
- **Environment Variable Gating:** Access to environment variables is gated via an allowlist (`execution.tools.envAllowlist`).

### 2. Secrets Handling

- **Redaction:** A redaction layer scans logs and LLM outputs to mask patterns that look like API keys or other credentials.
- **File Ignoring:** The agent respects `.gitignore` and `.orchestratorignore` to avoid reading sensitive files.

### 3. Memory & Privacy

- **Opt-In Memory:** Long-term memory is **disabled by default**.
- **Encryption-at-Rest:** When enabled, sensitive fields in the memory database are encrypted using AES-256-GCM. See the configuration details below. However, vector embeddings and metadata remain unencrypted.

## Recommended Baseline Configuration

For most projects, especially TypeScript monorepos, we recommend a "safe-by-default" configuration. This configuration should be the starting point and only relaxed for specific, trusted tasks.

```yaml
# .orchestrator.yaml

configVersion: 1

# Disable long-term memory to prevent code/conversation persistence.
memory:
  enabled: false

# Enforce confirmation for all high-risk tool operations.
execution:
  tools:
    enabled: true
    requireConfirmation: true
    autoApprove: false
    networkPolicy: deny
    envAllowlist: [] # Explicitly empty
    allowShell: false

# Optional: Encrypt memory if you choose to enable it.
# The key must be set in the ORCHESTRATOR_ENC_KEY environment variable.
# memory:
#   enabled: true
#   storage:
#     encryptAtRest: true
```

**For a more detailed checklist, see the [Hardening Guide](./hardening.md).**

## Operational Best Practices

Technology controls are only part of the solution. Your operational posture is critical.

- **Run in Isolated Environments:** For untrusted repositories, always run the CLI inside a container (e.g., Docker) or a VM to isolate its file system and network access.
- **Use Scoped, Ephemeral API Keys:** Generate unique API keys for the Orchestrator with limited permissions and rotate them regularly.
- **Regularly Wipe Memory:** If using the memory feature, periodically delete `.orchestrator/memory.sqlite` to purge sensitive context.
- **Vet External Adapters:** Only install and use third-party adapters from trusted sources. Review their implementation to understand the permissions they require.

## Limitations & Future Work

The Orchestrator is a powerful tool, and its security is an evolving process. Users should be aware of the following limitations:

- **Prompt Injection is Unsolved:** No system is immune to prompt injection. User confirmation is the final and most effective line of defense.
- **Run Artifacts are Unencrypted:** Files and logs under `.orchestrator/runs` are currently stored in plain text.
- **Vectors are Unencrypted:** In the memory database, vector embeddings are not encrypted. This could potentially leak information about the structure or content of your code.
- **Sandboxing is Not Yet Implemented:** The CLI does not yet run tool commands in a sandboxed environment. A compromised tool could potentially access anything the host user can access.

Future work aims to address these limitations by introducing run artifact encryption, full sandboxing for tool execution, and more advanced PII/secret scanning.
