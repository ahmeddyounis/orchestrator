# Claude Code Provider

The `claude_code` provider allows Orchestrator to integrate with Anthropic's [Claude Code](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code/overview) tool. Orchestrator invokes Claude Code as a subprocess, allowing it to act as an agent within the Orchestrator workflow.

## Prerequisites

Orchestrator does not redistribute Claude Code. You must install and authenticate it yourself before configuring it in Orchestrator.

1.  **Install Claude Code:** Follow the official instructions to install the `claude` CLI.
2.  **Authenticate:** Run `claude login` to authenticate with your Anthropic account.
3.  **Verify:** Ensure you can run `claude` from your terminal.

## Configuration

Add a `claude_code` provider to your `.orchestrator.yaml` or `~/.orchestrator/config.yaml`.

```yaml
providers:
  my-claude:
    type: 'claude_code'
    # Optional: Customize the command if 'claude' is not in your PATH
    # command: '/usr/local/bin/claude'
    # Optional: Pass additional arguments
    # args: ['--verbose']
    # Optional: Allowlist environment variables for the subprocess
    # env:
    #   - ANTHROPIC_API_KEY
```

### Configuration Options

| Option    | Description                                              | Default  |
| :-------- | :------------------------------------------------------- | :------- |
| `type`    | Must be `claude_code`.                                   | Required |
| `command` | The executable to run.                                   | `claude` |
| `args`    | List of arguments to pass to the command.                | `[]`     |
| `env`     | List of environment variables to pass to the subprocess. | `[]`     |

## Validation

To verify the integration, you can run a simple plan using the Claude Code provider.

```bash
orchestrator plan "Say hello" --planner my-claude
```

If successful, Orchestrator should initialize Claude Code, send the prompt, and receive a response.

## Known Issues & Troubleshooting

### Non-Interactive Mode vs PTY

Claude Code is designed primarily as an interactive CLI tool. Orchestrator interacts with it programmatically. Issues may arise if Claude Code expects a TTY (terminal) but doesn't detect one.

**Symptom:** The process hangs or exits immediately without output.
**Fix:** Ensure your environment allows subprocesses. Orchestrator attempts to manage PTY allocation, but system-specific limitations (especially on Windows or restricted container environments) may interfere.

### Prompt Detection

Orchestrator relies on detecting specific prompts from Claude Code to know when it's ready for input or has finished outputting.

**Symptom:** Orchestrator waits indefinitely even after Claude Code seems to have finished.
**Fix:** This is usually an internal handling issue. Check the logs in `.orchestrator/runs/<run-id>/tool_logs/` for raw output.

### Timeouts

Large requests or slow network connections might cause timeouts.

**Symptom:** "Timeout waiting for response" errors.
**Fix:** Currently, timeouts are hardcoded. If you experience frequent timeouts, please file an issue.
