# Retry Logic Documentation

This document describes the retry strategies used throughout the orchestrator system
for handling transient failures and ensuring robust execution.

## Overview

The orchestrator employs multiple retry mechanisms at different levels:

1. **Provider API Retry** - Low-level HTTP request retry for LLM provider calls
2. **L2 Repair Loop** - Step-level retry with verification-guided repair
3. **L3 Candidate Selection** - Multi-candidate generation with diagnosis
4. **Patch Application Retry** - Diff application with fallback strategies

## 1. Provider API Retry

### Location
`packages/adapters/src/common/index.ts`

### Strategy
Exponential backoff with jitter for transient API failures.

### Configuration

```typescript
interface RetryOptions {
  maxRetries?: number;      // Default: 3
  initialDelayMs?: number;  // Default: 1000
  maxDelayMs?: number;      // Default: 10000
  backoffFactor?: number;   // Default: 2
}
```

### Retriable Errors

| Error Type | HTTP Status | Description |
|------------|-------------|-------------|
| RateLimitError | 429 | Too Many Requests |
| TimeoutError | - | Request timeout |
| Server Error | 500-599 | Internal server errors |
| Network Error | ETIMEDOUT, ECONNRESET, ECONNREFUSED | Connection issues |

### Non-Retriable Errors

| Error Type | HTTP Status | Description |
|------------|-------------|-------------|
| ConfigError | 401, 403 | Authentication/authorization failures |
| Client Error | 400, 404, etc. | Invalid request (except 429) |
| AbortError | - | User cancellation |

### Delay Calculation

```
delay = min(maxDelayMs, initialDelayMs * (backoffFactor ^ (attempt - 1)))
jitter = delay * 0.1 * random(-1, 1)  // ±10%
finalDelay = max(0, delay + jitter)
```

### Metrics

The `ProviderRequestFinished` event includes:
- `retries`: Number of retry attempts (0 = first try succeeded)
- `success`: Whether the request ultimately succeeded
- `durationMs`: Total time including all retries
- `error`: Error message if failed

### Example Log Analysis

```json
{
  "type": "ProviderRequestFinished",
  "payload": {
    "provider": "anthropic",
    "durationMs": 15230,
    "success": true,
    "retries": 2
  }
}
```
This indicates the request succeeded after 2 retries (3 total attempts).

---

## 2. L2 Repair Loop

### Location
`packages/core/src/orchestrator.ts` - `runL2()` method

### Strategy
Iterative repair with verification feedback and escalation.

### Configuration

```yaml
# orchestrator.yaml
escalation:
  enabled: true
  toL3AfterNonImprovingIterations: 2  # Escalate after N non-improving attempts
  toL3AfterPatchApplyFailures: 2      # Escalate after N patch failures
  maxEscalations: 1                    # Maximum L2→L3 escalations per run
```

### Loop Behavior

1. **Max Iterations**: 5 (hardcoded)
2. **Stop Conditions**:
   - Verification passes
   - 2 consecutive non-improving iterations (same failure signature)
   - Budget exceeded (time, cost, iterations)
3. **Escalation Triggers**:
   - Non-improving: 2+ iterations with same failure signature
   - Patch failures: 2+ consecutive patch apply failures

### Failure Signature Tracking

The repair loop tracks a `failureSignature` hash to detect when repairs aren't making progress:

```typescript
if (failureSignature && verification.failureSignature === failureSignature) {
  consecutiveSameSignature++;
  if (consecutiveSameSignature >= 2) {
    // Non-improving → stop or escalate
  }
}
```

### Metrics

Events emitted:
- `IterationStarted`: Each repair iteration begins
- `RepairAttempted`: Repair patch generated
- `VerificationFinished`: Verification result after repair
- `RunEscalated`: Escalation from L2 to L3
- `RunStopped`: Loop terminated (with reason)

---

## 3. L3 Candidate Selection

### Location
`packages/core/src/orchestrator.ts` - `runL3()` method
`packages/core/src/orchestrator/l3/candidate_generator.ts`

### Strategy
Generate multiple candidates per step, evaluate against verification, select best.

### Configuration

```yaml
# orchestrator.yaml
l3:
  bestOfN: 3           # Number of candidates to generate
  enableReviewer: true # Use reviewer for tie-breaking
  enableJudge: true    # Use judge for complex decisions
  diagnosis:
    enabled: true
    triggerOnRepeatedFailures: 2  # Trigger diagnosis after N failures
    maxToTBranches: 3             # Max hypothesis branches
```

### Selection Flow

1. Generate N candidates (default: 3)
2. Validate each candidate (parse diff)
3. Evaluate against verification profile
4. **Selection priority**:
   - Passing candidates: Select minimal (smallest diff)
   - No passing: Use reviewer rankings
   - Near-tie: Invoke judge for tie-breaking

### Diagnosis System

When patch application fails repeatedly:

1. Trigger `DiagnosisStarted` event
2. Run `Diagnoser` to generate hypotheses
3. Add hypothesis as context signal
4. Re-fuse context with diagnosis
5. Reset failure counter

### Failure Tracking

```typescript
consecutiveInvalidDiffs  // No valid patch in output
consecutiveApplyFailures // Patch parse OK but apply failed
lastApplyErrorHash       // Track identical errors
```

### Metrics

Events emitted:
- `CandidateGenerated`: Each candidate generation attempt
- `JudgeInvoked`: When judge is used for selection
- `JudgeDecided`: Judge selection result
- `DiagnosisStarted`/`DiagnosisCompleted`: Diagnosis flow
- `StepFinished`: Step completion with judge info if used

---

## 4. Patch Application Retry

### Location
`packages/repo/src/patch/applier.ts`

### Strategy
Fallback approaches for malformed LLM-generated diffs.

### Retry Flow

1. **First attempt**: Standard `git apply`
2. **Fallback on "corrupt patch"**: Retry with `--recount` and stripped empty lines

```typescript
// LLM diffs often have incorrect hunk line counts
if (stderr.includes('corrupt patch at line')) {
  await tryApply(['--recount'], stripCompletelyEmptyLines(diffText));
}
```

### No-Op Detection

Diffs with only headers (no actual changes) are treated as successful no-ops:

```typescript
if (isNoOpDiff(normalizedDiffText)) {
  return { applied: true, filesChanged: [] };
}
```

---

## Monitoring Retry Frequency

### Aggregate Metrics

To monitor retry frequency across runs, analyze the trace files:

```bash
# Count provider retries per run
cat .orchestrator/runs/*/trace.jsonl | \
  jq 'select(.type == "ProviderRequestFinished") | .payload.retries' | \
  sort | uniq -c

# Find runs with escalations
cat .orchestrator/runs/*/trace.jsonl | \
  jq 'select(.type == "RunEscalated")'

# Track L2 repair iterations
cat .orchestrator/runs/*/trace.jsonl | \
  jq 'select(.type == "RepairAttempted") | .payload.iteration'
```

### Alerts

Consider alerting on:
- Provider retry rate > 20% of requests
- L2 escalation rate > 30% of L2 runs
- Average repair iterations > 3
- Diagnosis trigger rate > 10% of L3 steps

### Dashboard Queries

Key metrics for monitoring:

| Metric | Event | Field |
|--------|-------|-------|
| API retry rate | ProviderRequestFinished | retries > 0 |
| API failure rate | ProviderRequestFinished | success = false |
| L2 repair iterations | RepairAttempted | max(iteration) |
| L2 escalation rate | RunEscalated | from = "L2" |
| L3 diagnosis rate | DiagnosisStarted | count per run |
| Judge invocation rate | JudgeInvoked | count per run |
| Candidate validity rate | CandidateGenerated | valid = true / total |
