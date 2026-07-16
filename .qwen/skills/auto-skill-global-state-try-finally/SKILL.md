---
name: global-state-try-finally
description: When toggling global/shared state (setSilent, setLocale, etc.) for a scoped operation, always use try/finally to restore it — exceptions must not leak state changes
source: auto-skill
extracted_at: '2026-07-15T14:15:54.136Z'
---

# Global State Toggle Must Use try/finally

When a function temporarily changes global or shared state (logger silence, locale, working directory, environment variables, etc.) for a scoped operation, the restoration MUST be in a `finally` block. If the operation throws, the state must still be restored.

## The Bug Pattern

```typescript
// BUG: if scanProFiles throws, setSilent(false) never executes
setSilent(true);
const proFiles = scanProFiles(workroot);
setSilent(false);

// All subsequent log output is now permanently silenced
```

This was found in `init.ts` `scanProjects()` — `setSilent(true)` is called before scanning, but if the scanner throws, `setSilent(false)` is skipped, permanently silencing all log output for the rest of the process.

## The Fix

```typescript
setSilent(true);
try {
    const proFiles = scanProFiles(workroot);
} finally {
    setSilent(false);  // Always restored, even on exception
}
```

## Common Global State Toggles

| State | Set function | Restore value | Risk if leaked |
|-------|-------------|---------------|----------------|
| Logger silence | `setSilent(true)` | `setSilent(false)` | All subsequent logs lost |
| Global locale | `setGlobalLocale(locale)` | Previous locale | Wrong language for rest of session |
| Working directory | `process.chdir(dir)` | `process.chdir(original)` | All relative paths broken |
| Environment vars | `process.env.X = val` | `delete process.env.X` | Subprocesses inherit wrong config |
| Console override | `console.log = customFn` | Original console.log | All output broken |

## Multiple Toggles in Sequence

When multiple operations each need silence, don't chain them without try/finally:

```typescript
// BAD: second call not protected if first throws
setSilent(true);
const proFiles = scanProFiles(workroot);
setSilent(false);

setSilent(true);
const sdkFiles = scanSdkProjects({ workspace: workroot });
setSilent(false);
```

```typescript
// GOOD: each operation independently protected
setSilent(true);
try {
    const proFiles = scanProFiles(workroot);
} finally {
    setSilent(false);
}

setSilent(true);
try {
    const sdkFiles = scanSdkProjects({ workspace: workroot });
} finally {
    setSilent(false);
}
```

## Rules

1. **Every `set*` that changes shared state must have a matching `finally` restore** — no exceptions
2. **Don't assume the operation won't throw** — even "safe" operations like file scanning can throw (permission errors, encoding issues, etc.)
3. **Nested toggles need independent try/finally** — don't rely on outer finally to restore inner state
4. **If the function itself might return early**, the try/finally must wrap the entire scope including early returns

## Audit Checklist

- [ ] For every `setSilent(true)`: is there a `finally { setSilent(false) }`?
- [ ] For every `setGlobalLocale()`: is the previous locale saved and restored in finally?
- [ ] For every `process.chdir()`: is the original directory restored in finally?
- [ ] Are there sequences of toggle-operation-toggle without try/finally?
