# Repository Context

The Orchestrator builds a "context pack" for every plan generation to help the LLM understand your codebase. This document explains how context is gathered, configured, and troubleshooted.

## How it Works

The context generation process involves four steps:

1.  **Scanning**: The `RepoScanner` walks your repository to find all text files, respecting ignore rules.
2.  **Searching**: The `SearchService` finds relevant code snippets based on your goal, using both filename matching and content search (via `ripgrep`).
3.  **Extraction**: The `SnippetExtractor` pulls the actual code for the matches.
4.  **Packing**: The `ContextPacker` selects the best snippets to fit within the configured token budget.

## Configuration

You can configure context generation in your `.orchestrator.yaml` or `~/.orchestrator/config.yaml`.

```yaml
context:
  # Maximum number of tokens to include in the context (default: 10000)
  tokenBudget: 20000
  
  # Glob patterns to exclude from scanning (in addition to .gitignore)
  exclude:
    - "coverage/**"
    - "legacy-code/**"
    
  # Glob patterns to include (currently supported via negative excludes in .orchestratorignore)
  # include: [] 
  
  # Path to ripgrep executable (default: 'rg')
  # Useful if rg is not in your PATH
  rgPath: "/usr/local/bin/rg"
```

## Ignore Rules

The scanner respects the following ignore sources in order:

1.  **Default Ignores**: `node_modules`, `.git`, `dist`, `build`, etc.
2.  **`.gitignore`**: Standard git ignore file.
3.  **`.orchestratorignore`**: Orchestrator-specific ignore file (same syntax as .gitignore).
4.  **Config `context.exclude`**: Globs defined in your configuration file.

## Artifacts

For every run, the Orchestrator saves the generated context in the run directory (`.orchestrator/runs/<run-id>/`):

-   `context_pack.txt`: A human-readable text file containing all the code snippets sent to the LLM.
-   `context_pack.json`: A structured JSON file with metadata about the selected snippets, scores, and excluded candidates.

You can inspect these files to verify exactly what code the agent is seeing.

## Troubleshooting

### "ripgrep (rg) not found"

The Orchestrator prefers `ripgrep` for fast searching. If `rg` is not in your PATH, it falls back to a slower JavaScript implementation.

**Fixes:**
1.  Install ripgrep: `brew install ripgrep` (macOS) or see [ripgrep installation](https://github.com/BurntSushi/ripgrep#installation).
2.  Specify the path explicitly in config: `context.rgPath: "/path/to/rg"`.

### "Too much context" / "Context too large"

If the context pack is too large, it might consume too many tokens or confuse the model.

**Fixes:**
1.  Reduce `context.tokenBudget` in your config.
2.  Add irrelevant directories to `.orchestratorignore` or `context.exclude`.

### "Wrong package selected" / "Missing files"

If the agent isn't seeing the files it needs:

1.  Check `context_pack.txt` to see what WAS included.
2.  Check if the file is ignored by `.gitignore` or default ignores.
3.  Ensure the file is a text file (binary files are skipped).
4.  Try increasing `context.tokenBudget` if relevant files were found but "packed out" due to low scores.
