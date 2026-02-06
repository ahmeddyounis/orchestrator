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

| Option      | Description                                              | Default    |
| :---------- | :------------------------------------------------------- | :------- |
| `type`      | Must be `gemini_cli`.                                    | Required |
| `model`     | Gemini model name passed to `gemini --model`.            | Required |
| `command`   | The executable to run.                                   | `gemini` |
| `args`      | List of arguments to pass to the command.                | `[]`     |
| `env`       | List of environment variables to pass to the subprocess. | `[]`     |
| `pty`       | Spawn Gemini CLI in a PTY.                               | `false`  |
| `timeoutMs` | Max subprocess runtime (ms).                             | `600000` |

> **Note:** The `model` field is required. The adapter will throw a `ConfigError` at
> construction time if `model` is missing or empty.

## JSON Response Format

Orchestrator launches Gemini CLI with `--output-format json`, so the subprocess
produces a JSON object on stdout. The adapter extracts two top-level fields:

```jsonc
{
  "response": "<model text output>",
  "stats": {
    "models": {
      "<model-name>": {
        "tokens": {
          "prompt": 120,      // or "input"
          "candidates": 350,
          "total": 470
        }
      }
    }
  }
}
```

### `response`

A string containing the model's text output. Orchestrator uses this as the
authoritative response text. If the JSON cannot be parsed, or if `response` is
not a string, the adapter falls back to the raw stdout text.

### `stats`

An optional object that carries token-usage telemetry. The adapter walks
`stats.models` and sums token counts across all reported models:

| Token field    | Meaning                         |
| :------------- | :------------------------------ |
| `prompt`       | Input/prompt tokens (primary)   |
| `input`        | Input tokens (fallback alias)   |
| `candidates`   | Output/candidate tokens         |
| `total`        | Total tokens (computed if absent) |

If every token counter is zero (or absent), the adapter treats usage as
unavailable and falls back to any usage data returned by the base subprocess
layer.

### Parsing behaviour

1. The adapter locates the first `{` and last `}` in the subprocess output and
   attempts `JSON.parse` on that slice.
2. If parsing fails, a `console.debug` message is emitted and the raw text is
   used as-is.
3. After obtaining the response text, the adapter checks for unified-diff
   markers (`BEGIN_DIFF` / `END_DIFF`) and plan markers to classify the
   response.

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
