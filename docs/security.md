# Threat Model & Safety Baseline

This document outlines the security posture for the Orchestrator CLI. It identifies key assets, potential threats, and the controls (both MVP and future) implemented to mitigate risks.

## Assets

1.  **Repository Code:** The user's codebase, which may contain proprietary logic.
2.  **Secrets:** API keys (e.g., LLM provider keys), database credentials, and other sensitive environment variables.
3.  **User Machine:** The local file system and execution environment where the CLI runs.
4.  **Logs:** Execution logs, which might inadvertently capture sensitive data.
5.  **Memory Database:** Vector database storing embeddings of code and interactions (if enabled).

## Threats

### 1. Prompt Injection via Repository Content
*   **Description:** Malicious instructions embedded in the codebase (e.g., in a README or code comment) that could trick the LLM into executing unauthorized actions.
*   **Risk:** Medium to High (depending on autonomy level).

### 2. Secrets Exfiltration
*   **Description:** The agent accidentally reading environment files (like `.env`) and sending them to the LLM provider, or logging them to disk.
*   **Risk:** High.

### 3. Destructive Commands
*   **Description:** The agent executing shell commands that delete files (`rm -rf`), modify system settings, or install malware.
*   **Risk:** Critical.

### 4. Malicious Plugins/Tools
*   **Description:** Loading third-party tools or extensions that compromise the environment.
*   **Risk:** Medium (mitigated by strict tool definitions).

## Security Principles

1.  **Least Privilege:** The agent should only have access to the files and commands necessary for the task.
2.  **Explicit Confirmation:** High-risk actions (file writes, shell execution) require user approval (human-in-the-loop).
3.  **Local-First Logs:** Logs are stored locally and redacted before any potential sharing or analysis.
4.  **Defense in Depth:** Multiple layers of security (LLM prompt engineering, application-level checks, OS-level permissions).

## MVP Controls

These controls are enforced in the initial version of the Orchestrator.

### 1. Command Execution Policy
*   **Denylist:** The agent is explicitly forbidden from running dangerous commands (e.g., `sudo`, dangerous `rm` patterns) without explicit, granular confirmation.
*   **Confirmation:** All shell commands defaults to requiring user confirmation.

### 2. Secrets Handling
*   **Redaction:** A redaction layer is applied to logs and LLM outputs to mask patterns looking like API keys or credentials.
*   **File Ignoring:** The agent respects `.gitignore` and `.dockerignore` to avoid reading sensitive ignored files.

### 3. Memory & Privacy
*   **Opt-In Memory:** Long-term memory features are off by default.
*   **Local Execution:** The CLI runs locally; code is only sent to the configured LLM provider and nowhere else.

## Future Controls

*   **Sandboxing:** Running the agent or its tool execution environment within a Docker container or Firecracker microVM.
*   **Encryption-at-Rest:** Encrypting the vector database and local logs.
*   **Stricter Policy Engine:** A configurable policy engine allowing users to define fine-grained allow/deny lists for tools and paths.
*   **PII/Secret Scanning:** Advanced pre-flight scanning of context sent to the LLM.

## Artifact Logs & Sensitive Data

*   **Principle:** Logs should be safe to share for debugging purposes.
*   **Implementation:** All logger outputs pass through a redactor. This redactor attempts to identify and mask:
    *   Credit card numbers
    *   API keys (AWS, Stripe, OpenAI, etc.)
    *   Email addresses (optional/configurable)
    *   IP addresses (optional/configurable)
