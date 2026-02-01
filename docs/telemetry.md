# Telemetry

We are committed to transparency and user privacy. This document explains what data the Orchestrator collects and how it is used.

## Guiding Principles

- **Privacy First:** All telemetry is **disabled by default**. You must explicitly opt-in to enable any data collection.
- **Transparency:** We will always be clear about what data we are collecting and why.
- **User Control:** You have the ability to enable, disable, or wipe your telemetry data at any time.

## Default Behavior: Local-Only Artifacts

By default (`telemetry.enabled: false`), the Orchestrator operates in a **local-only** mode. It **does not send any data** over the network.

All artifacts generated during a run are stored locally on your machine inside the `.orchestrator/` directory in your repository root. These artifacts include:

- **Run Logs:** Detailed logs of the agent's operations, thoughts, and tool calls.
- **Effective Configuration:** The final configuration used for the run (`effective-config.json`).
- **State Checkpoints:** Snapshots of the agent's state to allow for resuming runs.
- **Memory:** If enabled, the agent's memory is stored in a local SQLite database (`.orchestrator/memory.sqlite`).
- **Index:** If enabled, a local index of your codebase is stored in `.orchestrator/index/`.

## What is NOT Logged

Even when telemetry is enabled in the future, we are committed to **never** logging the following sensitive information:

- **API Keys and Secrets:** All keys are redacted by default.
- **File Contents:** The content of your source files is never sent.
- **Personally Identifiable Information (PII):** We will make every effort to avoid collecting PII.

## How to Wipe Local Artifacts

You can completely remove all locally generated artifacts by deleting the `.orchestrator/` directory from your project.

```bash
rm -rf .orchestrator
```

## Future Remote Telemetry (Opt-In)

To help us improve the Orchestrator, we may introduce an opt-in remote telemetry feature in the future. This will be **off by default** and will require an explicit action to enable (`telemetry.enabled: true`, `telemetry.mode: remote`).

When enabled, we will collect anonymized data about agent performance, tool usage, and errors. This data will be invaluable for identifying bugs, improving agent accuracy, and prioritizing new features.
