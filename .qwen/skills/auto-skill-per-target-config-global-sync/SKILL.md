---
name: per-target-config-global-sync
description: When config needs to vary per target/entity but downstream consumers read from a global store, use a per-target store + sync-on-switch pattern
source: auto-skill
extracted_at: '2026-07-04T00:10:00Z'
---

# Per-Target Config with Global Sync

## When to Apply

When configuration items need to **vary per target** (e.g., different toolchain paths for different projects) but **downstream consumers** (build, run, etc.) read from a **global/shared store**.

## Pattern

### 1. Extend the target entity with config fields

```typescript
interface ActiveTarget {
    // ... existing fields ...
    qtPath?: string;      // per-target config
    vsInstall?: string;   // per-target config
}
```

### 2. Create a per-target config store

A separate storage file that maps target identifiers to their config:

```typescript
// Stored in ~/.forja/projects/<hash>.json (type: 'targetToolchains')
Record<string, TargetConfig>  // key = project path, value = config
```

Use the existing config path infrastructure (`projectConfigPath`/`resolveConfigPath`) with a new `ConfigType`.

### 3. Save on setup/configure

When configuring a target, save to **both** the global store AND the per-target store:

```
setup flow:
  1. User selects target + configures toolchain
  2. Save toolchain to ActiveTarget (per-target memory)
  3. Save toolchain to QtSettings/SdkSettings (global, for downstream)
  4. Save toolchain to targetToolchains[projectPath] (per-target store)
```

### 4. Sync on switch

When switching targets, look up the per-target store:

```
switch target flow:
  1. Load per-target store
  2. If new target has entry → restore config to global store
  3. If no entry → prompt user to configure (interactive) or return questions (JSON)
  4. Save new config to per-target store + global store
```

### 5. Downstream unchanged

Build/run/stop commands continue reading from the global store (QtSettings/SdkSettings). No changes needed — the sync-on-switch ensures the global store always reflects the active target's config.

## Key Design Decisions

- **Per-target store is the source of truth** for "what was configured for this target before"
- **Global store is the source of truth** for "what is currently active"
- **Sync direction**: per-target → global (on switch), never global → per-target
- **Backward compatibility**: old targets without per-target config → prompt on first switch
- **Interactive vs JSON**: interactive prompts for config, JSON mode returns `needs-input` + questions

## Path Normalization for Store Keys

Per-target store keys MUST use **canonical workspace-relative paths** with forward slashes. Different code paths can produce different string forms for the same project:

- Scanner returns: `"subdir/MyApp.pro"` (workspace-relative)
- User input: `"MyApp.pro"` (raw, may be basename only)
- `resolveProjectPath`: may return either depending on match method

**Fix:** After resolving the project path, compute canonical key:

```typescript
const canonicalProject = matchedCandidate?.project 
    || path.relative(workspace, finalPath).replace(/\\/g, '/');
```

Use `canonicalProject` for ALL per-target store lookups and writes. Without this, the same target gets duplicate store entries under different keys, and lookups silently miss.

## All Config Layers Must Update Consistently

When saving config, **every** layer must be updated — missing one causes silent inconsistency:

| Layer | What to save | When |
|-------|-------------|------|
| ActiveTarget | kind, project, mode, arch, runAt, qtPath, vsInstall, jomPath, qmakeTarget | Always (if mode/arch resolved) |
| Domain config (QtSettings/SdkSettings) | pinnedProject, mode, arch, qtPath, vsInstall, jomPath, target | Always |
| Per-target store | qtPath, vsInstall, jomPath, qmakeTarget | Always (even if mode/arch skipped) |

**Common bugs:**
- ❌ `saveSdkConfig` not saving mode/arch (SDK-only projects get defaults)
- ❌ `saveQtConfig` early-return skipping mode/arch when no Qt candidates
- ❌ `!existingTarget` guard preventing mode/arch update on re-run
- ❌ `sameTarget` branch only syncing toolchain paths, not mode/arch
- ❌ Partial save (mode/arch skipped) not saving toolchain to per-target store

**Fix:** Extract a `savePerTargetToolchain()` helper and call it from ALL save paths (new target, same target, partial save).

## Anti-patterns

- ❌ Storing per-target config only in the global store (loses history on switch)
- ❌ Making downstream consumers read from per-target store (too many changes)
- ❌ Using defaults to fill missing per-target config (user explicitly skipped — don't override)
