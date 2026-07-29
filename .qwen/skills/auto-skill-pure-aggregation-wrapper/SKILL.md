---
name: pure-aggregation-wrapper
description: When a function mixes I/O loading with aggregation logic, split into pure function (all inputs explicit) + convenience wrapper (loads then delegates) — callers with cached data use the pure function directly
source: auto-skill
extracted_at: '2026-06-29T14:03:54.508Z'
---

# Pure Aggregation + Convenience Wrapper

When a function internally loads data (configs, files, state) and then aggregates/processes it, split into two functions:

1. **Pure aggregation function** — all inputs as explicit parameters, no internal I/O
2. **Convenience wrapper** — loads data then delegates to the pure function

## Why

In `collectTargetCandidates`, the function loaded `activeTarget`, `qtConfig`, `sdkConfig` internally. Callers like `status.ts` had already loaded these same configs, causing redundant I/O. The first attempt (`preloaded?: { qtConfig?, sdkConfig? }`) was awkward — partial injection with `??` fallbacks.

The clean fix: split into `aggregateCandidates(workspace, activeTarget, qtConfig, sdkConfig)` (pure) + `collectTargetCandidates(workspace)` (wrapper).

## Pattern

```typescript
// Pure — all inputs explicit, no config I/O
export function aggregateCandidates(
    workspace: string,
    activeTarget: ActiveTarget | null,
    qtConfig: QtSettings,
    sdkConfig: SdkSettings,
): TargetCandidate[] {
    // ... aggregation logic only
}

// Convenience wrapper — loads configs then delegates
export function collectTargetCandidates(workspace: string): TargetCandidate[] {
    const activeTarget = loadActiveTarget(workspace);
    const qtConfig = loadQtSettings(workspace);
    const sdkConfig = loadSdkSettings(workspace);
    return aggregateCandidates(workspace, activeTarget, qtConfig, sdkConfig);
}
```

## Rules

- The pure function takes **all** data dependencies as parameters — no internal `load*` calls
- The convenience wrapper has the **same signature** as the original function (backward compatible)
- Callers who already have the data call the pure function directly
- Callers who don't care use the convenience wrapper unchanged
- Use imported types (e.g. `QtSettings`) for parameters, not `ReturnType<typeof loadQtSettings>`
- If the pure function needs async operations (e.g., `detectEnv()` for system scanning), the wrapper becomes `async` too — all callers must `await` it. Check for non-CLI callers (e.g., vscode/commands.ts) that also need updating.

## Applied examples

This pattern was applied twice in the forja CLI:

1. **`aggregateCandidates`** (pure) + **`collectTargetCandidates`** (wrapper) — target scanning
2. **`resolveRemoteConfigFrom`** (pure) + **`resolveRemoteConfig`** (wrapper) — remote config resolution

Both followed the same structure: extract the core logic into a pure function that takes pre-loaded configs, keep the original as a thin wrapper that loads then delegates.

## Anti-pattern to avoid

Don't use partial injection with optional fields:
```typescript
// BAD — awkward, inconsistent (some injected, some loaded)
function collect(workspace: string, preloaded?: { qtConfig?, sdkConfig? }) {
    const qtConfig = preloaded?.qtConfig ?? loadQtSettings(workspace);
    // ...
}
```

## When to apply

- When a caller already has the data that a callee loads internally
- When reviewing for redundant config/data loading (see module-redundancy-review pass 2 & 4)
- When a function's test setup requires mocking I/O that's not the function's core purpose
