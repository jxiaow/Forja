---
name: post-resolution-metadata-sync
description: After resolving a selection from candidates, persist associated metadata (versions, labels) to config — read-only commands should never re-detect what was already known at write time
source: auto-skill
extracted_at: '2026-07-06T02:23:31.751Z'
---

# Post-Resolution Metadata Sync

After a user selects an item from a candidate list (e.g., Qt path, VS install), associated metadata (version numbers, labels, editions) must be **persisted to config** at write time. Read-only commands (status, list) read from config — they never re-detect.

## Core Principle: Detect Once at Config Time, Read From Config Thereafter

When a write command (`use target`, `setup`) resolves user selections, it already has access to the full candidate list with metadata. Save the metadata alongside the selection. Read-only commands (`status`) just read what was saved.

```ts
// WRONG: status re-detects Qt version by running qmake --version every time
function buildToolchainSummary(...) {
    const qtInfo = await parseQtInfo(qtConfig.qtPath, ''); // expensive shell call
    summary.qt = { path: qtConfig.qtPath, version: qtInfo.version };
}

// RIGHT: use target saves version when user selects Qt
// In resolveAll:
const qtVersion = ctx.toolchain.qtCandidates.find(q => q.path === qtPath.value)?.version;
config.qtVersion = qtVersion;
// In saveDomainFields:
qt.qtVersion = config.qtVersion;
// In status:
summary.qt = { path: qtConfig.qtPath, version: qtConfig.qtVersion };
```

## Bug Pattern: Stale Default Metadata

```ts
// Phase 1: Detect environment — sets qtVersion from env default (first candidate)
const toolchain = await detectToolchain(workspace);
// toolchain.qtVersion = '5.15.13' (env default)

// Phase 2: Resolve — user picks a DIFFERENT Qt from candidates
const resolved = await resolveAll(ctx, options);
// resolved.config.qtPath = 'C:\Qt\5.15.2' (user selected)

// Phase 3: Report — uses toolchain.qtVersion which is STILL the env default
buildSuccessResult(resolved.config, ctx.toolchain, ...);
// Output: "Qt (5.15.13): C:\Qt\5.15.2" — WRONG version!
```

## Rules

1. **Write commands persist metadata** — when `use target`/`setup` resolves a selection, save associated metadata (version, edition) to config (settings.json + per-target toolchain store)
2. **Read commands read from config** — `status`/`list` display what's stored, never re-detect by running external tools
3. **Detection sets defaults, resolution picks specifics** — the detect phase populates env-wide defaults; the resolve phase captures user selections with their metadata
4. **Shallow-copy before mutating** — `{ ...ctx.toolchain }` to avoid corrupting the original context when doing display-time lookups
5. **Apply to all code paths** — interactive, flag, answers, switch target — all must persist metadata

## Audit Checklist

When adding metadata to a selection flow:
- [ ] Is the metadata persisted to config at write time (settingsIO + toolchain store)?
- [ ] Do read-only commands read from config instead of re-detecting?
- [ ] Does the resolve phase look up metadata from candidates (not env defaults)?
- [ ] Is this applied to ALL code paths (interactive, flag, answers, switch)?
- [ ] Is the original context object not mutated (shallow copy)?
