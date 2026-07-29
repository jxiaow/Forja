---
name: unified-data-source-across-views
description: When a command has both a summary view and a detail sub-view, both must use the same data source for the same information — never maintain parallel detection/query paths
source: auto-skill
extracted_at: '2026-07-02T12:18:50.463Z'
---

# Unified Data Source Across Views

When a command displays the same information in multiple contexts (e.g. a summary view `list env` and a detail sub-view `list env vs`), both views **must** use the same underlying data source. Maintaining parallel detection/query functions for the same information leads to silent divergence — different views show different results for the same thing.

## Rule

If two code paths display the same kind of data (e.g. "available VS installations"), they must call the same detection function — not two different functions that happen to return similar results.

## Real Example

`forja list env` (summary) and `forja list env vs` (detail) both show available VS installations.

**Before (divergent sources):**
- `listEnvAll()` → `detectEnv().vsCandidates` → uses `scanVS()` → vswhere.exe → found 2 VS
- `listEnvVs()` → `detectVsInstallations()` → SDK filesystem scan → found 1 VS

Users saw `list env` showing 2 VS but `list env vs` showing only 1 — confusing and wrong.

**After (unified source):**
- Both call `detectEnv().vsCandidates` (vswhere-based)
- Both show the same 2 VS installations

## Additional Pitfall: Platform-Dependent Field Semantics

Shared result types may overload fields across platforms. `EnvInfo.jom` contains:
- Windows: actual jom path
- Linux: make path (because `detectEnvLinux()` stores make result in the `jom` field)

Consumers must be platform-aware:
```typescript
if (process.platform === 'win32') {
    if (env.jom) { summary.jom = env.jom; }  // jom on Windows
} else {
    if (env.jom) { summary.make = true; }     // make on Linux
}
```

## Additional Pitfall: Redundant Detection Calls

If `detectEnv()` already detects make internally (via `detectEnvLinux()`), don't call a separate `detectMake()` in the consumer. Reuse the result already in `env.jom`. Redundant calls waste time and risk returning different results.

## Audit Checklist

When a command has multiple views of the same data:

- [ ] Do all views use the same detection/query function for the same information?
- [ ] Are there parallel detection functions that should be consolidated?
- [ ] Are platform-dependent field semantics handled correctly in all consumers?
- [ ] Are there redundant detection calls that could reuse results from a parent detection?
- [ ] Do the text formatter and JSON output use the same data fields (not different sources)?
