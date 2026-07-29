---
name: cli-build-pre-kill
description: CLI build must terminate running exe before building — resolve exe path from Makefile/project and call terminateExecutable, matching VSCode buildManager behavior
source: auto-skill
extracted_at: '2026-07-06T09:28:23.555Z'
---

# CLI Build Pre-Kill — Terminate Running Exe Before Building

When `forja build` runs, it must kill any running instance of the target executable before starting the build. Without this, the linker fails with `LNK1104: cannot open file` because the exe is locked by the running process.

## The Pattern

```typescript
// Before build execution (not for qmake/rcc/clean):
if (target.kind === 'qt' && (buildAction === 'default' || buildAction === 'fresh')) {
    const projectDir = path.dirname(resolvedProjectPath);
    const runtimeInfo = resolveRuntimeTarget(projectDir, target.mode, target.arch);
    if (runtimeInfo?.exePath) {
        terminateExecutable(runtimeInfo.exePath);
    }
}
```

## Key Details

1. **Resolve exe path from project** — Use `resolveRuntimeTarget(projectDir, mode, arch)` which reads the Makefile to find the output exe path. This is the same approach VSCode's `buildManager.ts` uses.

2. **Only for build actions that produce an exe** — Skip for `qmake`, `rcc`, `clean`. Only `default` and `fresh` (full rebuild) need pre-kill.

3. **Only for Qt targets** — SDK targets use different build systems and typically don't have the same exe locking issue.

4. **Fire-and-forget** — `terminateExecutable` is a no-op if the exe isn't running. No error if the process doesn't exist.

## Why This Was Missing

VSCode's `buildManager.ts` (line ~207) calls `terminateExecutable(mfInfo.exePath)` before every build. The CLI `build.ts` was missing this step entirely, causing `LNK1104` errors when users ran `forja run` then `forja build` without manually stopping first.

## Related

- `terminateExecutable` is in `src/qt/shared/commandRunner.ts`
- `resolveRuntimeTarget` is in `src/qt/shared/runtimeTarget.ts`
- The mechanism (path-aware kill) is covered by the `linux-pre-build-kill` skill
