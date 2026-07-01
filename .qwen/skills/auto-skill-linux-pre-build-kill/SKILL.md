---
name: linux-pre-build-kill
description: Pre-build process kill must be path-aware — use Node.js-level terminateByPath, never shell-level name-based kill
source: auto-skill
extracted_at: '2026-06-30T03:15:11.395Z'
---

# Pre-Build Process Kill — Path-Aware, Node.js Level

When killing a previous instance before build/run (to allow overwriting the executable), use **Node.js-level path-based kill** — never shell-level name-based kill.

## The Rule: Kill at Node.js Level, Not Shell Level

Shell commands (`taskkill /IM`, `pkill -x`) match by process name — this can kill unrelated processes with the same name from different directories. Instead, do the kill in Node.js before the command chain:

```typescript
// In runCliResult, before executing the build/run chain:
if (result.action === 'run' || result.action === 'build') {
    terminateByPath(result.executablePath);
}
```

`terminateByPath` uses `findExecutablePids(executablePath)` which:
- **Windows**: PowerShell `Get-CimInstance Win32_Process` matches by `ExecutablePath`
- **Linux**: `ps -axo pid=,comm=,args=` + `/proc/pid/exe` symlink comparison

Both are path-aware — only processes running our specific binary get killed.

## Why Not Shell-Level Kill

1. **Name-based kill is imprecise** — `taskkill /IM app.exe` kills ALL `app.exe` processes, even from different build directories
2. **CMD escaping makes path-based shell commands impractical** — embedding PowerShell path matching in a CMD command chain has intractable quoting issues with `&`, `|`, `$`
3. **Node.js already has the infrastructure** — `findExecutablePids` does path-aware matching on both platforms

## Shell-Level Kill Remains as Fallback Only

The `killCommand(exeName, exePath?)` interface still exists for:
- `stop` action (uses `stopCommands`)
- Dry-run output visibility

But for the critical pre-build/run kill, always prefer the Node.js-level `terminateByPath`.

## Never Block the Build

The Node.js kill is fire-and-forget — if the process doesn't exist or can't be killed, execution continues. If the file is locked, the build will fail with a clear OS error.

## Fallback when exePath is unknown

When `executablePath` is not set (e.g., Makefile not yet generated), `terminateByPath` is a no-op. The build proceeds normally — there's no previous instance to kill if we don't know the executable path.

## Why

Original Linux implementation used `pkill -x` with `/proc/pid/exe` verification in a shell command. Windows used `taskkill /IM` (name-only) despite receiving `exePath` parameter. Both were replaced with a single Node.js-level `terminateByPath` that does path-aware matching on both platforms, avoiding the CMD escaping nightmare and the name-collision bug.
