---
name: command-assembly-consolidation
description: Consolidate duplicate build/run command assembly logic across VSCode and CLI execution paths
source: auto-skill
extracted_at: '2026-06-22T04:30:00.000Z'
---

# Command Assembly Consolidation

When a project has parallel VSCode and CLI execution paths, the "command assembly" logic (deciding what shell commands to run) often gets duplicated — once in VSCode-specific modules and once in CLI-shared modules. This leads to drift where the two paths produce different commands.

## When This Applies

- A project has both VSCode task-based execution and CLI process-based execution
- Build/run/clean commands are assembled in two separate places
- The two paths produce different shell commands (e.g., `devenv` vs `msbuild`)
- You're refactoring to reduce duplication

## The Problem Pattern

```
VSCode path:                    CLI path:
  sdkBuilder.ts                   cli/commands/build.ts
  → buildWindowsCommand()         → createSdkPlan()
  → "devenv /Build"                 → buildCommand()
  → vscode.Task                     → "msbuild /t:Build /m"
                                    → cp.exec()
```

Two separate functions that do the same thing (assemble a build command) but:
1. Produce different commands (different tools, different flags)
2. Are maintained independently
3. May drift over time

## The Solution: Single Assembly Source

```
Shared assembly (no vscode dependency):
  shared/plan.ts :: buildCommand()
    ↙                    ↘
VSCode:                  CLI:
  sdkBuilder.ts            cli/commands/build.ts
  → buildCommand()         → createSdkPlan() → buildCommand()
  → vscode.Task            → cp.exec()
```

## Process

### 1. Identify Duplicate Assembly Points

Look for functions that produce shell command strings in both VSCode and CLI code:

```bash
# Find command assembly in VSCode-side modules
grep -rn "buildCommand\|buildWindowsCommand\|buildLinuxCommand" src/

# Find command assembly in CLI/shared modules
grep -rn "createSdkPlan\|createActionPlan" src/
```

Key indicators:
- Functions that return `string` or `string[]` containing shell commands
- Platform-specific branching (`isWindows`, `os.platform()`)
- Tool invocation strings (`msbuild`, `devenv`, `make`, `qmake`, `jom`)

### 2. Compare the Two Implementations

Create a comparison table:

| Aspect | VSCode Path | CLI Path | Match? |
|--------|-------------|----------|--------|
| Windows tool | `devenv` | `msbuild` | ❌ |
| Parallel flag | None | `/m` | ❌ |
| Linux build | `cd && make MODE=` | `make -C` | ❌ |
| Linux rebuild | `make clean && make` | `make clean all` | ❌ |

### 3. Choose the Canonical Implementation

Pick the better implementation as the single source:
- Prefer the one that is more correct / more feature-complete
- Prefer the one that uses modern tooling (`msbuild` over `devenv`)
- Prefer the one that doesn't depend on `vscode`

### 4. Export from Shared Location

Move or expose the canonical assembly function from a shared module:

```typescript
// shared/plan.ts — no vscode dependency
export function buildCommand(options: PlanOptions): string[] {
    // Single source of truth for command assembly
}
```

### 5. Update VSCode Path to Use Shared Assembly

```typescript
// sdkBuilder.ts — VSCode-specific execution only
import { buildCommand, PlanOptions } from '../shared/plan';

// Before:
command = buildWindowsCommand({ vsDevCmdPath, slnPath, mode, arch, action });

// After:
const planOptions: PlanOptions = { action, project, mode, arch, vsDevCmdPath };
const commands = buildCommand(planOptions);
const command = commands.join(' && ');
// Then wrap in vscode.Task as before
```

### 6. Delete Redundant Assembly Code

Remove the old platform-specific command builders that are no longer needed:
- Delete files that only contained command assembly (now in shared module)
- Remove interfaces/types that were only used by the deleted functions
- Keep only the VSCode-specific parts (shell options, task creation)

## Key Principles

- **Separate assembly from execution**: Command string generation (what to run) should be separate from execution mechanism (how to run it — `vscode.Task` vs `cp.exec`)
- **Shared assembly must not depend on vscode**: The assembly layer is consumed by both CLI and VSCode paths
- **Execution layer stays platform-specific**: `vscode.Task` wrapping, `ShellExecutionOptions`, problem matchers — these are VSCode-specific and belong in the VSCode execution layer
- **One tool per platform**: Don't have `devenv` in one path and `msbuild` in another. Pick one and use it everywhere.

## Example: SDK Consolidation

**Before** (two implementations):
- `sdk/platform/windows.ts`: `buildWindowsCommand()` → `devenv /Build`
- `sdk/platform/linux.ts`: `buildLinuxCommand()` → `cd && make MODE=`
- `sdk/shared/plan.ts`: `buildCommand()` (private) → `msbuild /t:Build /m`

**After** (single source):
- `sdk/shared/plan.ts`: `buildCommand()` (exported) → `msbuild /t:Build /m`
- `sdk/platform/windows.ts`: Only `getWindowsShellOptions()` (VSCode shell config)
- `sdk/platform/linux.ts`: Deleted

## Checklist

- [ ] All command assembly functions identified across VSCode and CLI paths
- [ ] Differences between implementations documented
- [ ] Canonical implementation chosen and exported from shared module
- [ ] VSCode path updated to call shared assembly function
- [ ] CLI path already uses shared assembly (or updated to do so)
- [ ] Redundant platform-specific command builders deleted
- [ ] Tests pass (especially SDK CLI tests that assert on command output)
- [ ] No remaining references to deleted functions
