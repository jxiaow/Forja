---
name: linux-pre-build-kill
description: Linux pre-build process kill must verify executable path via /proc/pid/exe — never kill by name alone, never block the build
source: auto-skill
extracted_at: '2026-06-30T03:15:11.395Z'
---

# Linux Pre-Build Process Kill

When killing a process before build (to allow overwriting the executable), follow these rules:

## Never kill by name alone

`pkill -x "AppName"` matches ANY process with that name — it could be an unrelated program. Only kill after verifying the process is actually running our build output.

## Use /proc/pid/exe for path-based matching

```bash
for _p in $(pgrep -x "AppName" 2>/dev/null); do
  [ "$(readlink /proc/$_p/exe 2>/dev/null)" = "/full/path/to/build/output/AppName" ] && kill $_p 2>/dev/null
done; true
```

This reads the actual executable symlink from procfs — only processes running our specific binary get killed.

## Never block the build

Always end with `; true` so the kill step is non-fatal. If the process is ours and the file is locked, `make` will fail with a clear "text file busy" error. If it's not ours, the build proceeds normally.

## Fallback when exePath is unknown

When the build output path is not available (e.g., Makefile not yet generated), fall back to name-based `pkill` but still make it non-fatal:

```bash
pkill -x "AppName" 2>/dev/null; true
```

## killCommand interface

```typescript
killCommand(exeName: string, exePath?: string): string;
```

Pass `exePath` when available (from `resolveRuntimeTarget().exePath`). Omit it only in fallback scenarios.

## Why

User's build failed because `pkill` sent SIGTERM, `pgrep` checked immediately (process still dying), and `exit 1` aborted the entire build command before `make` ever ran. Then on review: killing by name alone could kill unrelated processes with the same name.
