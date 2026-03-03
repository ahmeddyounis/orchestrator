# Architecture Invariants

This document defines **invariants** that keep the Orchestrator monorepo maintainable as it grows.
When making changes, prefer enforcing these rules with tooling (TypeScript project references,
package exports, ESLint) rather than relying on convention alone.

## Dependency Direction

The intended dependency direction is:

`shared` → (`repo`, `adapters`, `plugin-sdk`) → (`memory`, `exec`) → `core` → `cli`

Invariants:

1. `@orchestrator/shared` must not depend on any other workspace package.
2. `@orchestrator/plugin-sdk` is a stable plugin-facing surface and should remain minimally coupled
   (generally depends only on `shared`).
3. `@orchestrator/cli` may depend on anything, but should remain “composition only”:
   - parse flags, configure services, render output
   - avoid re-implementing domain logic that belongs in `core`

## Public API Boundaries

Invariants:

1. Cross-package imports must use the package entrypoint and the public `exports` map:
   - ✅ `import { ProviderRegistry } from '@orchestrator/core'`
   - ❌ `import { ProviderRegistry } from '@orchestrator/core/src/registry'`
2. Each package should have a small, intentional surface area. Add exports deliberately.

## Lifecycle & Resource Management

Provider/adapter lifecycle:

1. Adapters may own external resources (subprocesses, sockets, temp dirs).
2. Adapters can implement `shutdown()` for cleanup.
3. Registries that cache adapters must provide a “shutdown all” mechanism and clear caches after
   shutdown.

Plugin lifecycle:

1. Plugins must not assume `init()` will always be followed by `generate()`/`stream()`.
2. Plugin `init()` failures must not create unhandled promise rejections.
3. Plugin `shutdown()` should be best-effort and must not hang the process indefinitely.

## Observability

Invariants:

1. High-level lifecycle transitions should emit structured events (and be written to trace artifacts):
   - plugin discovery/load/init/shutdown
   - provider adapter creation/validation/shutdown
2. User-facing CLIs (`doctor`, `run`, `fix`) should present actionable diagnostics with enough
   context to debug failures (provider id/type, plugin name, hint text).

## Testing Guardrails

Invariants:

1. Prefer small unit tests for extracted services.
2. Keep deterministic tests as the integration backstop (especially around orchestration loops).
3. Always keep `pnpm check` green (format/lint/typecheck/test/audit).
