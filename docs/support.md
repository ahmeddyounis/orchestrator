# Support and Troubleshooting

If you encounter a bug or have a problem, this guide explains how to get help and file a report that will help us resolve the issue quickly.

## Filing a Bug Report

The best way to report a bug is to create an issue on our [GitHub repository](https://github.com/example/orchestrator/issues).

A good bug report is detailed and reproducible. Please include the following information in your issue.

### 1. Describe the Bug

- A clear and concise description of what the bug is.
- The command you ran.
- What you expected to happen.
- What actually happened.

### 2. Include Logs

Logs are essential for debugging. Please include the relevant logs from your run.

- **Run Log**: The main log file for a specific run is located in `.orchestrator/logs/`. Find the log file corresponding to the timestamp of your run and attach it to the issue.
- **Sanitize Logs**: Before posting logs, please review them and remove any sensitive information, such as API keys, file paths, or proprietary code.

### 3. Create an Export Bundle

The orchestrator includes a command to bundle up your configuration and other non-sensitive information for debugging.

```bash
orchestrator export-bundle
```

This command will create a `orchestrator-bundle.zip` file in your current directory. It includes:

- Your configuration (with secrets redacted).
- A list of enabled plugins.
- Indexing statistics.
- Version information.

**Please attach this bundle to your GitHub issue.** It provides valuable context without revealing sensitive data.

### 4. Provide a Minimal Reproduction

If possible, create a small, self-contained example that reproduces the issue. This could be a small git repository or a set of files that consistently trigger the bug. This is the single most helpful thing you can do to get an issue resolved quickly.

## Common Issues

Before filing a report, check if your issue is covered here.

- **"Invalid API Key" errors**: Double-check that your API key is correct and that it has been added to your `~/.orchestrator/config.json` or project-level config.
- **"Command not found" for tools**: Ensure that any required command-line tools are installed and available in your system's `PATH`.
- **"Index not found"**: Run `orchestrator index` in the root of your project.

If you have a question or need help with configuration, you can also start a discussion on our [GitHub Discussions page](https://github.com/example/orchestrator/discussions).
