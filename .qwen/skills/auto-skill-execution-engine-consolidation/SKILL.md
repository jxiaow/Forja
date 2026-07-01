---
name: execution-engine-consolidation
description: When multiple execution engines exist for similar operations (e.g. separate cp.exec wrappers), consolidate to the more capable one — don't maintain parallel executors
source: auto-skill
extracted_at: '2026-07-01T09:01:36.502Z'
---

# Execution Engine Consolidation

When a codebase has multiple execution engines (wrappers around `cp.exec`, `child_process.spawn`, etc.) for similar operations, they inevitably drift in capability. The less capable one should be replaced with the more capable one — not maintained in parallel.

## When This Applies

- Two modules each have their own `execute()` / `execAsync()` wrapper around `cp.exec`
- One engine has features the other lacks (streaming output, encoding handling, log writing, error extraction, detach mode)
- A new command path is implemented with a bare `cp.exec` when a richer engine already exists elsewhere
- You're adding a new command that needs to execute shell commands

## The Problem Pattern

```
Qt path:                          SDK path:
  commandRunner.ts                  plan.ts
  → runCliResult()                  → executeSdkAsync()
  → streaming ✓                     → streaming ✗
  → GBK decode ✓                    → GBK decode ✗
  → warning summary ✓               → warning summary ✗
  → log file ✓                      → log file (manual, per-call)
  → error extraction ✓              → error extraction (manual, per-call)
  → detach mode ✓                   → detach mode ✗
```

Two execution engines doing the same thing (run shell commands) but with vastly different capability levels. Every caller of the weaker engine misses out on features.

## The Solution: Single Execution Engine

```
Shared execution engine:
  commandRunner.ts :: runCliResult()
    ↙                    ↘
Qt callers:              SDK callers:
  build.ts                 build.ts
  clean.ts                 clean.ts
  → runCliResult()         → runCliResult()  (was executeSdkAsync)
```

## Process

### 1. Identify All Execution Wrappers

```bash
grep -rn "cp\.exec\|cp\.spawn\|execAsync\|executeAsync" src/ --include="*.ts"
```

Look for:
- Functions that wrap `child_process.exec` or `child_process.spawn`
- Functions that return `Promise<{ exitCode, stdout, stderr }>`
- Manual log writing after command execution
- Manual error extraction from output

### 2. Compare Capabilities

| Feature | Engine A | Engine B |
|---------|----------|----------|
| Streaming output | ✓ | ✗ |
| Encoding handling | ✓ (GBK) | ✗ (UTF-8 only) |
| Error extraction | ✓ (built-in) | ✗ (manual per-call) |
| Warning summary | ✓ | ✗ |
| Log file writing | ✓ (automatic) | ✗ (manual per-call) |
| Detach/background | ✓ | ✗ |

### 3. Choose the More Capable Engine

Pick the engine with more features. It becomes the single execution engine.

### 4. Verify Interface Compatibility

The richer engine's input/output format must be compatible with all callers. If the weaker engine returns a different type, adapt the richer engine's interface or add a thin adapter.

Key: The richer engine should accept the same input format (e.g., `CliResult` with `commands`, `shellCommand`, `workspace`) so callers can switch with minimal changes.

### 5. Update All Callers

Replace every call to the weaker engine with the richer engine. Remove manual log writing, error extraction, etc. from callers — the richer engine handles these internally.

### 6. Delete the Weaker Engine

Remove the function and its imports. Verify no remaining references:

```bash
grep -rn "executeSdkAsync\|extractSdkErrors" src/
```

## Rules

- **One execution engine per codebase** — if two modules need to run shell commands, they should use the same engine
- **Prefer the richer engine** — never replace a feature-rich engine with a bare `cp.exec` wrapper
- **Engine must not depend on platform-specific modules** — the execution engine should work for all callers (CLI, VSCode, SDK, remote)
- **Error extraction belongs in the engine** — callers shouldn't manually parse compiler output for errors
- **Log writing belongs in the engine** — callers shouldn't manually write log files after execution

## Audit Checklist

When reviewing execution paths:

- [ ] All `cp.exec` / `cp.spawn` wrappers identified
- [ ] Capabilities compared across engines
- [ ] Single engine chosen and used by all callers
- [ ] Dead execution functions removed
- [ ] Manual log writing / error extraction removed from callers
- [ ] No remaining imports of deleted functions
