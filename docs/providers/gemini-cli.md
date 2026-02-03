# Gemini CLI Provider

The `gemini_cli` provider allows Orchestrator to integrate with Google's `gemini` CLI as a subprocess, so you can run Orchestrator using local CLI authentication instead of API keys.

## Prerequisites

Orchestrator does not redistribute Gemini CLI. You must install and authenticate it yourself before configuring it in Orchestrator.

1. **Install Gemini CLI:** Install the `gemini` executable (for example via Homebrew on macOS).
2. **Authenticate:** Ensure Gemini CLI can run non-interactively (e.g. `gemini -p "Hello"`).
3. **Verify:** Ensure you can run `gemini --help` from your terminal.

## Configuration

Add a `gemini_cli` provider to your `.orchestrator.yaml` or `~/.orchestrator/config.yaml`.

```yaml
providers:
  my-gemini:
    type: 'gemini_cli'
    model: 'gemini-2.5-flash'
    # Optional: Customize the command if 'gemini' is not in your PATH
    # command: '/opt/homebrew/bin/gemini'
    # Optional: Pass additional arguments (do not include --model/--prompt/--output-format)
    # args: ['--sandbox']
    # Optional: Allowlist environment variables for the subprocess
    # env: []
    # Optional: Increase/decrease the subprocess timeout (ms).
    # timeoutMs: 600000
```

### Configuration Options

| Option      | Description                                              | Default  |
| :---------- | :------------------------------------------------------- | :------- |
| `type`      | Must be `gemini_cli`.                                    | Required |
| `model`     | Gemini model name passed to `gemini --model`.            | Required |
| `command`   | The executable to run.                                   | `gemini` |
| `args`      | List of arguments to pass to the command.                | `[]`     |
| `env`       | List of environment variables to pass to the subprocess. | `[]`     |
| `pty`       | Spawn Gemini CLI in a PTY.                               | `false`  |
| `timeoutMs` | Max subprocess runtime (ms).                             | `600000` |

## Validation

To verify the integration, you can run a simple plan using the Gemini CLI provider.

```bash
orchestrator plan "Say hello" --planner my-gemini
```

## Known Issues & Troubleshooting

### Do not set `--model`, `--prompt`, or `--output-format` in `args`

Orchestrator manages these internally for reliability.

**Symptom:** Orchestrator fails at startup with a config error.
**Fix:** Remove the conflicting flags from your provider `args`.

### Timeouts

Large requests or slow network connections might cause timeouts.

**Symptom:** "Timeout waiting for response" errors.
**Fix:** Increase `timeoutMs` in the provider config.

