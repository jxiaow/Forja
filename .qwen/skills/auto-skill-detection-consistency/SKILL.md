---
name: detection-consistency
description: Setup/init toolchain detection must use the same scanning functions as list/status — never write a simplified "config-only" check that diverges from real detection
source: auto-skill
extracted_at: '2026-07-03T09:35:59.562Z'
---

# Detection Consistency Across Commands

When setup/init commands need to detect toolchains, environment, or system capabilities, they **must** call the same detection functions used by list/status commands — not a simplified local alternative.

## Anti-Pattern: Lightweight Local Detection

Writing a "quick check" that only reads saved config to detect toolchains:

```typescript
// BAD: only checks saved config paths
function detectToolchain(workspace: string) {
    const qt = loadQtSettings(workspace);
    if (qt.qtPath && fs.existsSync(qt.qtPath)) { result.qt = true; }
    // ...
}
```

This fails on fresh setups where config is empty but tools are installed — setup reports "未检测到 Qt" while `list env` finds it fine.

## Correct Approach

Call the same full detection function used by list/status:

```typescript
// GOOD: uses the same detectEnv() as `list env`
async function detectToolchain(workspace: string) {
    setSilent(true);
    const env = await detectEnv();  // full system scan
    setSilent(false);
    // map env → result, with config fallback for non-standard paths
}
```

## Key Considerations

1. **Suppress scan logs**: Use `setSilent(true)` before calling detection functions that use `log()` — setup output should show results, not scan progress
2. **Config fallback**: After system scan, fall back to saved config for paths the scanner doesn't cover (non-standard install locations)
3. **Async**: Real detection is often async (spawns subprocesses like vswhere, qmake). The detection function must be `async` and `await`ed
4. **Platform field mapping**: The same `EnvInfo` may use different fields per platform (e.g., `jom` field = jom on Windows, make on Linux). Map correctly in the consumer

## Audit Checklist

When a setup/init command reports detection results:

- [ ] Does it call the same detection function as the corresponding list/status command?
- [ ] Are scan logs suppressed for clean CLI output?
- [ ] Is there a config fallback for paths the scanner can't find?
- [ ] Are platform-dependent fields mapped correctly?
- [ ] Are there any local/simplified detection functions that should be removed?
