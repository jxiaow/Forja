---
name: multi-workspace-resolution
description: Commands must resolve active target across ALL configured workspace roots (Qt + SDK) — never assume a single workspace
source: auto-skill
extracted_at: '2026-06-25T07:43:01.976Z'
---

# Multi-Workspace Target Resolution

The project has two independent workspace roots: Qt and SDK. Each is configured separately via `forja use qt` / `forja use sdk` and stored in separate config files. Commands that read the active target MUST search across ALL configured workspace roots.

## The Problem

`workspace()` / `getWorkspaceRoot()` defaults to the Qt workspace root. When Qt is not configured (common), it falls back to `process.cwd()` — which in VSCode is the VSCode install directory, NOT the user's project.

This causes:
- `getActiveTarget(workspace())` returns null → build routes to Qt instead of SDK
- `collectTargetCandidates(workspace())` scans wrong directory → finds 0 targets
- `resolveProjectRoot('qt')` returns empty → fallback to `process.cwd()` → scans VSCode install dir

## The Fix: `resolveActiveTarget()` Helper

In `src/vscode/commands.ts`:

```typescript
async function resolveActiveTarget() {
    const { resolveProjectRoot } = await import('./workspaceResolver');
    const sdkWs = resolveProjectRoot('sdk') || '';
    const qtWs = resolveProjectRoot('qt') || '';
    return getActiveTarget(sdkWs) || getActiveTarget(qtWs) || getActiveTarget(workspace());
}
```

**All commands that read the active target must use this helper**: `forja.build`, `forja.run`, `forja.stop`, `forja.clean`, `forja.debug`.

## The Fix: Workspace Fallback for Scanning

In `forja._selectTarget` and similar commands that scan for targets:

```typescript
let qtWs = resolveProjectRoot('qt') || '';
let sdkWs = resolveProjectRoot('sdk') || '';
// Fallback: if one is empty, use the other
if (!qtWs && sdkWs) { qtWs = sdkWs; }
if (!sdkWs && qtWs) { sdkWs = qtWs; }
if (!qtWs && !sdkWs) { qtWs = sdkWs = workspace(); }
```

**Never** fall back to `process.cwd()` directly — it's unreliable in VSCode extension context.

## Scanner Consolidation

When both CLI and VSCode need to scan for projects, use ONE shared scanner:

- `src/core/sdkProjectScanner.ts` — shared, no vscode dependency
- CLI (`candidates.ts`) imports `scanSdkProjects()` from core
- SDK module (`ProjectScanner`) imports `scanSdkProjects()` from core

**Never** maintain separate scan implementations with independent exclusion rules — they WILL drift apart (e.g., one excludes `build` directories, the other doesn't).

## Rules

1. **Never use `getActiveTarget(workspace())` directly** — use `resolveActiveTarget()` which tries SDK root first
2. **Never fall back to `process.cwd()` for scanning** — use the other workspace root if one is empty
3. **One scanner per project type** — shared in `core/`, used by both CLI and VSCode
4. **When adding new commands that read target config**, always use `resolveActiveTarget()`
5. **When adding new commands that scan for targets**, always resolve both workspace roots

## Common Pitfalls

- **SDK target saved but build uses Qt**: Target saved to SDK workspace config, but `workspace()` returns Qt workspace → `getActiveTarget` returns null → falls through to Qt build path
- **VSCode install dir in scan results**: `resolveProjectRoot('qt')` returns empty → fallback to `process.cwd()` = VSCode install dir → scans `.pro` files from VSCode's own directory
- **Scanner exclusion drift**: CLI scanner excludes `build` dirs, SDK scanner only excludes `build/output` → CLI finds 4 targets, SDK finds 11 → user sees inconsistent results
