---
name: context-object-params
description: When a function has 5+ parameters sharing common state, extract a context object instead of passing them individually
source: auto-skill
extracted_at: '2026-07-03T12:04:30.968Z'
---

# Context Object for Shared State

When multiple functions share a common set of parameters (workspace, config, toolchain, etc.), extract a context object instead of passing 5+ individual parameters.

## Anti-Pattern: Parameter Bloat

```typescript
// BAD: 9 parameters — which ones are related? What's the call site look like?
function saveQtConfig(
    workspace: string, existing: QtSettings, existingTarget: ActiveTarget | null,
    toolchain: ToolchainDetection, mode: string | undefined, arch: string | undefined,
    reset: boolean | undefined, savedToolchain: string[],
    qtCandidates: Candidate[],
): boolean { ... }

// Call site is unreadable:
saveQtConfig(workspace, existingQt, existingActiveTarget, toolchain, effectiveMode, effectiveArch, options.reset, savedToolchain, qtCandidates);
```

## Pattern: Context Object

```typescript
// GOOD: shared state in one object, function-specific params separate
interface InitContext {
    workspace: string;
    reset?: boolean;
    toolchain: ToolchainDetection;
    mode?: string;
    arch?: string;
    existingTarget: ActiveTarget | null;
    savedToolchain: string[];
}

function saveQtConfig(
    ctx: InitContext, existing: QtSettings, qtCandidates: Candidate[],
): boolean {
    // Access shared state via ctx.workspace, ctx.toolchain, ctx.mode, etc.
}

// Call site is clear:
saveQtConfig(ctx, existingQt, qtCandidates);
```

## Rules

1. **Threshold**: When a function needs 5+ parameters, consider a context object
2. **Shared vs specific**: Put shared state (workspace, config, toolchain) in the context; keep function-specific params (existing config, candidates) as separate arguments
3. **Mutable shared state**: If functions need to write back results (like `savedToolchain.push(...)`), put the mutable array in the context — all functions share the same reference
4. **Build once, pass everywhere**: Construct the context object once in the orchestrator function, pass it to all helpers

## When NOT to Use

- Functions with 2-4 parameters — not worth the indirection
- Functions that don't share state with siblings — just use individual params
- One-off functions called once — context objects add ceremony

## Checklist

- [ ] Does any function have 5+ parameters?
- [ ] Do multiple functions share the same subset of parameters?
- [ ] Is there mutable shared state (arrays, counters) passed to multiple functions?
