Status: DONE
Summary of changes:
- Created `packages/shared/src/types/llm.ts` with standard LLM types (`ChatMessage`, `ModelRequest`, `ModelResponse`, `ProviderCapabilities`, `StreamEvent`, `Usage`, `ToolSpec`, `ToolCall`).
- Exported these types from `packages/shared/src/index.ts`.
- Refactored `packages/shared/src/logger/jsonlLogger.ts` to export a `Logger` interface and implement it in `JsonlLogger`, decoupling the logger type.
- Added `@orchestrator/shared` dependency to `@orchestrator/adapters`.
- Created `packages/adapters/src/types.ts` defining `AdapterContext` (using the new `Logger` interface).
- Created `packages/adapters/src/adapter.ts` defining the `ProviderAdapter` interface.
- Updated `packages/adapters/src/index.ts` to export the new types and interfaces.
- Updated `packages/adapters/src/index.test.ts` to implement a `MockAdapter` and verify the interface against the acceptance criteria.

How to verify:
- Build: `pnpm build --filter @orchestrator/shared --filter @orchestrator/adapters`
- Test: `pnpm test --filter @orchestrator/adapters`

Risks / follow-ups:
- `StreamEvent` types might need refinement as we implement actual streaming providers (e.g. OpenAI vs Anthropic differences).
- `ToolCall` arguments are `unknown`, consumers will need to validate/parse them (e.g. using Zod).
