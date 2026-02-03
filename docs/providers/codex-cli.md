# Codex CLI Provider

The `codex_cli` provider allows Orchestrator to integrate with OpenAI's `codex` CLI as a subprocess.

## Prerequisites

Orchestrator does not redistribute Codex CLI. You must install and authenticate it yourself before configuring it in Orchestrator.

1. **Install Codex CLI:** Install the `codex` executable.
2. **Authenticate (hosted):** Run `codex login`, or ensure `OPENAI_API_KEY` is set for the subprocess.
3. **Authenticate (local OSS):** If you want to run without API keys, configure Codex CLI with `--oss` (requires a local provider like LM Studio or Ollama).
4. **Verify:** Ensure you can run `codex exec --help` from your terminal.

## Configuration

Add a `codex_cli` provider to your `.orchestrator.yaml` or `~/.orchestrator/config.yaml`.

```yaml
providers:
  my-codex:
    type: 'codex_cli'
    model: 'o3-mini'
    # Optional: Customize the command if 'codex' is not in your PATH
    # command: '/opt/homebrew/bin/codex'
    # Optional: Pass additional arguments (do not include exec/--model/--json/--output-schema or '-')
    # args: ['--oss', '--local-provider', 'ollama']
    # Optional: Allowlist environment variables for the subprocess
    # env:
    #   - OPENAI_API_KEY
    # Optional: Increase/decrease the subprocess timeout (ms).
    # timeoutMs: 600000
```

### Configuration Options

| Option      | Description                                              | Default  |
| :---------- | :------------------------------------------------------- | :------- |
| `type`      | Must be `codex_cli`.                                     | Required |
| `model`     | Codex model name passed to `codex exec --model`.         | Required |
| `command`   | The executable to run.                                   | `codex`  |
| `args`      | List of arguments to pass to the command.                | `[]`     |
| `env`       | List of environment variables to pass to the subprocess. | `[]`     |
| `pty`       | Spawn Codex CLI in a PTY.                                | `false`  |
| `timeoutMs` | Max subprocess runtime (ms).                             | `600000` |

## Validation

To verify the integration, you can run a simple plan using the Codex CLI provider.

```bash
orchestrator plan "Say hello" --planner my-codex
```

## Known Issues & Troubleshooting

### Do not set `exec`, `--model`, `--json`, `--output-schema`, or `-` in `args`

Orchestrator manages these internally for reliability and machine-readable output.

**Symptom:** Orchestrator fails at startup with a config error.
**Fix:** Remove the conflicting flags from your provider `args`.

### Timeouts

Large requests or slow network connections might cause timeouts.

**Symptom:** "Timeout waiting for response" errors.
**Fix:** Increase `timeoutMs` in the provider config.

