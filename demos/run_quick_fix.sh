#!/bin/bash

set -e

# Reset the repo to a known state
git -C demos/ts-monorepo-demo clean -fdx
git -C demos/ts-monorepo-demo reset --hard HEAD

# Run the orchestrator
export FAKE_ADAPTER_BEHAVIOR="SUCCESS"
node packages/cli/dist/index.js run --config demos/ts-monorepo-demo/config.json "fix the test"

# Print where artifacts are stored
echo "Artifacts are stored in the .runs directory"