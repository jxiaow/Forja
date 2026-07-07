---
name: pre-execution-context-header
description: Long-running operations (build, run, deploy, sync) must show execution context (location, target, config) BEFORE starting — not just after completion
source: auto-skill
extracted_at: '2026-07-06T02:32:51.910Z'
---

# Pre-Execution Context Header

Long-running operations must print a **context header** before starting execution — showing where it runs, what it operates on, and with what configuration. Users need this info BEFORE the build starts, not buried in post-completion output.

## Anti-Pattern: Context Only After Completion

```ts
// WRONG: target/mode/arch only shown after build finishes
function outputBuildResult(result) {
    console.log(`→ ${result.runAt}`);
    console.log(`Target: ${result.project} · ${result.mode}/${result.arch}`);
    console.log(`Build succeeded`);
}
```

The user sees raw tool output (qmake, jom, make) scrolling by with no idea what's being built or where.

## Correct Pattern: Header Before Execution

```ts
// RIGHT: show context before any build commands run
function runBuild(...) {
    const target = resolveTarget(...);

    // Header — text mode only, not for plan/dry-run
    if (!wantsJson && !options.plan) {
        console.log(`→ ${target.runAt === 'remote' ? 'remote:' + serverName : 'local'}`);
        console.log(`  Target  ${target.project}`);
        console.log(`  Mode/Arch  ${target.mode} | ${target.arch}`);
        console.log();  // blank line before tool output
    }

    // ... actual build execution ...
}

// Post-completion: just show result summary (no duplicate context)
function outputBuildResult(result) {
    console.log(`Build ${result.ok ? 'succeeded' : 'failed'}`);
    console.log(`Duration: ${result.durationMs}ms`);
}
```

## Output Example

```
→ local
  Target  qt_client/qt_linux_pc_client/qt_linux_pc_client.pro
  Mode/Arch  release | x86

jom 1.1.4 - empower your cores
C:\Qt\bin\qmake.exe -o Makefile ...
...
Build succeeded
Duration: 4523ms
```

## Rules

1. **Header before execution** — show location, target, and relevant config BEFORE any tool output starts
2. **No duplicate context at the end** — the post-completion summary shows result + duration, not repeated target/mode/arch
3. **Text mode only** — JSON mode doesn't need a header (all context is in the JSON result)
4. **Skip for plan/dry-run** — plan mode shows commands, not execution; header would be misleading
5. **Blank line separator** — add an empty line between the header and tool output for visual clarity

## Audit Checklist

- [ ] Does `build` show execution location and target before starting?
- [ ] Does `run` show what process is being started?
- [ ] Does `sync` show server and direction before transferring?
- [ ] Is the context NOT repeated in the post-completion summary?
- [ ] Is the header suppressed in JSON and plan modes?
