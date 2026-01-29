# Architecture

This document describes the high-level architecture of the Orchestrator system.

## Overview

The Orchestrator is designed as a modular monorepo, separating concerns into distinct packages.

## Package Responsibilities

| Package                    | Description                                                                              |
| :------------------------- | :--------------------------------------------------------------------------------------- |
| **@orchestrator/cli**      | The entry point for the command-line interface. Handles user input and commands.         |
| **@orchestrator/core**     | Contains the core domain entities and business logic independent of external frameworks. |
| **@orchestrator/exec**     | The execution engine responsible for running workflows and tasks.                        |
| **@orchestrator/eval**     | Handles evaluation strategies, potentially for analyzing outputs or making decisions.    |
| **@orchestrator/memory**   | Manages long-term memory, context, and state persistence.                                |
| **@orchestrator/repo**     | The repository layer, abstracting file system and database access.                       |
| **@orchestrator/adapters** | Adapters for integrating with external tools, APIs, or services.                         |
| **@orchestrator/shared**   | Common utilities, types, and helpers used across multiple packages.                      |

## Data Flow (High Level)

_(Placeholder: Diagram or description of how data moves from CLI -> Core -> Exec -> Adapters)_

1. **CLI** receives a command from the user.
2. **Core** processes the intent and orchestrates the workflow.
3. **Exec** executes the specific steps defined in the workflow.
4. **Memory** is consulted or updated to maintain context.
5. **Adapters** are used to interact with the outside world (file system, network, etc.) via **Repo**.

## Adding a New Package

When adding a new package:

1. Determine if the functionality belongs in an existing package or requires a new domain boundary.
2. Follow the `@orchestrator/<name>` naming convention.
3. Ensure strict dependency boundaries (e.g., `shared` should not depend on `cli`).
