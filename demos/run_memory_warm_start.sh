#!/bin/bash

set -e

# Reset the repo to a known state
git -C demos/ts-monorepo-demo clean -fdx
git -C demos/ts-monorepo-demo reset --hard HEAD

# Set the behavior for the adapter, the first run will fail, the second will succeed.
export FAKE_ADAPTER_BEHAVIOR="FAIL,SUCCESS"

# Run the orchestrator the first time, it should fail
node packages/cli/dist/index.js run --config demos/ts-monorepo-demo/config.memory.json "fix the test" || true

# Run the orchestrator the second time, it should succeed
node packages/cli/dist/index.js run --config demos/ts-monorepo-demo/config.memory.json "fix the test"

# Print where artifacts are stored
echo "Artifacts are stored in the .runs directory"