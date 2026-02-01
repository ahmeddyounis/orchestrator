#!/bin/bash
set -e

REPO_DIR="large_repo_fixture"
rm -rf $REPO_DIR
mkdir -p $REPO_DIR

# Create a large number of files
for i in {1..5000}; do
  mkdir -p "$REPO_DIR/packages/package-$((i % 100))/src"
  echo "console.log('hello from file $i');" > "$REPO_DIR/packages/package-$((i % 100))/src/file-$i.ts"
done

# Create some large files
for i in {1..10}; do
  dd if=/dev/urandom bs=1m count=5 | base64 > "$REPO_DIR/large-file-$i.bin"
done

# Create a .gitignore
echo "*.bin" > "$REPO_DIR/.gitignore"

echo "Created large repo fixture at $REPO_DIR"
