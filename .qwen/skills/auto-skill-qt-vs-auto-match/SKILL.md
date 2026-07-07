---
name: qt-vs-auto-match
description: Qt target VS version must be auto-matched from Qt path compiler tag (msvc2019/msvc2022), not user-selected — mismatched VS causes build errors
source: auto-skill
extracted_at: '2026-07-06T06:14:56.925Z'
---

# Qt Target VS Auto-Matching

When selecting a Qt target, the VS version must be automatically matched from the Qt installation path's compiler tag, not left to user selection. Qt is compiled against a specific MSVC version — using a different VS version causes build errors (e.g., `stdext` namespace removed in VS 2022+).

## The Problem

User selects Qt path `C:\QtCompile\msvc2019-accessible` (compiled with VS 2019), then manually picks VS 2026 → build fails with `error C2653: "stdext": not a class or namespace`.

## The Fix

Extract the compiler year from the Qt path and filter VS candidates:

```typescript
function extractVsYearFromQtPath(qtPath: string): string | null {
    const match = qtPath.match(/msvc(\d{4})/);
    return match ? match[1] : null;  // "2019", "2022", or null
}
```

## Rules

1. **Qt path has compiler tag** (e.g., `msvc2019`, `msvc2022`) → filter VS candidates to matching version only
   - 1 match → auto-select silently
   - Multiple matches (Community + Professional) → let user choose among matching ones
   - 0 matches → warn `⚠ Qt 需要 VS 2019，未检测到，请手动选择` + fall back to all candidates (user chooses)
2. **Qt path has no tag** → cannot determine, fall back to letting user choose all candidates (no warning)
3. **SDK targets** → no filtering, VS selection works as before (SDK projects work with any VS)
4. **Apply in ALL flows**: `resolveAll` (interactive no-flag path), `runSwitchTarget` interactive path, AND `runSwitchTarget` non-interactive fallback path — all three must filter VS candidates

## Implementation

In `resolveAll` (resolve.ts), after resolving qtPath for Qt targets:

```typescript
if (kind === 'qt' && qtPath.value) {
    const vsYear = extractVsYearFromQtPath(qtPath.value);
    if (vsYear) {
        const filtered = ctx.toolchain.vsCandidates.filter(v => v.version === vsYear);
        if (filtered.length > 0) {
            vsCandidatesOverride = filtered;
        }
    }
}
const vsInstall = await resolveVsPath(ctx, options, stored, vsCandidatesOverride);
```

`resolveVsPath` accepts optional `candidatesOverride` parameter to use filtered list instead of full `ctx.toolchain.vsCandidates`.

## Why This Matters

- Qt 5.15.2 (msvc2019) + VS 2022 = `stdext` removed → hard compile error
- Qt 5.15.13 (msvc2019) + VS 2022 = works (patched headers)
- The Qt path tag is the ground truth for which MSVC was used to compile Qt
- Users shouldn't need to know this — the tool should prevent mismatches
