# Context Fusion

The "Context Fusion" process is at the heart of how the Orchestrator understands your requests. It's the mechanism that gathers, prioritizes, and combines information from multiple sources to create a single, coherent "fused context" that is provided to the AI agent.

This document explains how this fusion process works and where you can find the resulting artifacts for debugging and inspection.

## Information Sources

The fused context is assembled from three primary sources:

1.  **Repository Context:** This includes information extracted directly from your codebase. It comprises file contents, file paths, and symbol information (classes, functions, etc.) that are deemed relevant to the current task. Relevance is determined by a combination of heuristics and the indexing service.
2.  **Memory:** The Orchestrator's long-term memory provides historical context from past interactions. This includes previously successful commands, edited files, and other learned knowledge.
3.  **Signals:** These are dynamic, in-the-moment cues that provide immediate context. The most important signal is the user's prompt, but it can also include clipboard content, open files in the IDE, and other real-time information.

## The Fusion Process

The fusion process is governed by a system of budgets and prioritization rules. Each section of the final context (e.g., relevant files, memory snippets, diagnostics) is allocated a "token budget."

1.  **Prioritization:** Information from each source is ranked based on relevance. For example, files explicitly mentioned in the prompt receive the highest priority. Memories are ranked based on a combination of recency, relevance, and past utility.
2.  **Budgeting:** The Orchestrator fills each section of the context with the highest-priority items until its budget is exhausted.
3.  **Truncation:** If a single item (like a long file) exceeds the budget for its section, it is truncated to fit. The truncation is designed to be intelligent, preserving the most relevant parts of the content where possible (e.g., by keeping the start and end of a file).

This budget-based approach ensures that the final context sent to the AI is as dense with relevant information as possible while staying within the model's context window limitations.

## Provenance and Debugging

The Orchestrator is designed for transparency. After each run, it saves detailed artifacts that allow you to inspect the context fusion process. These are stored in the `.orchestrator/runs/<run_id>/` directory for the specific run.

Key artifacts include:

-   `fused_context.json`: A JSON file containing the final, fully assembled context that was sent to the AI. This is the "source of truth" for what the agent knew.
-   `provenance.json`: A detailed report that explains *why* each piece of information was included in the context. It shows the source of each item, its original score, and any truncation that was applied.

### Example: Verifying Memory Usage

If you want to verify that a specific memory was used in a run, you can:

1.  Find the `run_id` for your latest run.
2.  Open the `provenance.json` file in that run's directory.
3.  Search for the memory item in the `sections` array. The provenance data will show you its source path and how it was ranked.

This allows you to trust and verify that the agent is using its memory correctly and to debug cases where its behavior is unexpected.
