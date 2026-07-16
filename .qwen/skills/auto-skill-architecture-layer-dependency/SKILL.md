---
name: architecture-layer-dependency
description: Lower layers (core/, remote/core/) must never import from higher layers (cli/, vscode/) — reverse dependencies couple modules and break locale/context isolation
source: auto-skill
extracted_at: '2026-07-16T00:00:00.000Z'
---

# Architecture Layer Dependency Direction

Lower layers must never import from higher layers. When a core module imports from a CLI or UI module, it creates coupling that breaks isolation, causes locale mismatches, and makes the core unusable in other contexts.

## Layer Hierarchy

```
Entry points (highest):  cli/index.ts, extension.ts
    ↓
Command layer:           cli/commands/*, vscode/commands.ts
    ↓
Feature modules:         qt/, sdk/, remote/, sync/
    ↓
Core (lowest):           core/, remote/core/, shared/
```

Dependencies flow **down only**. A module at layer N may import from layer N-1 or below, never from N+1 or above.

## The Bug Pattern

```typescript
// src/remote/core/config.ts — a CORE layer module
import { T } from '../../cli/commands/types';  // ← imports from CLI layer!

function blocked(message: string) {
    return {
        diagnostics: [{ level: 'error', message: T('config.noServerSelected') }],
        nextAction: T('config.configureSyncHint')  // ← uses CLI translation
    };
}
```

### Why This Is Wrong

1. **Locale mismatch**: `T()` depends on `_globalLocale` set by CLI entry point. When VSCode calls the same core function, `setGlobalLocale()` was never called → messages always return English, even for Chinese users.

2. **Circular dependency risk**: `core → cli/commands/types → core/settingsIO` creates import cycles that bundlers and test runners struggle with.

3. **Unusable in other contexts**: If a future entry point (e.g., language server, API) imports `remote/core/config.ts`, it must also set up the CLI translation system — coupling it to a specific UI layer.

## The Fix

Core modules should use **inline messages** or **error codes**, not translation functions:

```typescript
// Before: core imports CLI translation
import { T } from '../../cli/commands/types';
return blocked(T('config.noServerSelected'));

// After: core uses inline English, caller translates if needed
return blocked('No server selected');
```

The CLI/VSCode layer that calls the core function can translate the message if it needs to display it to the user.

## Common Violations to Check

| Lower layer module | Tempting import from | Correct approach |
|-------------------|---------------------|-----------------|
| `core/*` | `cli/commands/types` (T) | Inline messages or error codes |
| `core/*` | `vscode/*` | Never — core must be pure Node.js |
| `remote/core/*` | `cli/commands/*` | Return structured errors, let CLI format |
| `sync/*` (core files) | `vscode` | Only vscode-specific files (watcher, sftp) import vscode |
| `shared/*` | `vscode` | shared must not depend on vscode (AGENTS.md rule) |

## Audit Checklist

When reviewing a module's imports:

- [ ] Does any import path go "up" the layer hierarchy? (e.g., `../../cli/` from `core/`)
- [ ] Does a core module use `T()` or other CLI/UI functions?
- [ ] Does a core module import `vscode`? (except explicitly allowed modules)
- [ ] Are error messages in core modules hardcoded in a specific language? (should be English or error codes)
- [ ] Can this module be imported from a different entry point without pulling in UI dependencies?

## Rules

- **Core modules return data, not formatted strings** — the presentation layer formats
- **Error messages in core = English** — locale-aware translation happens at the entry point
- **`T()` is a CLI/UI concern** — core modules don't know about locales
- **Test the import graph** — `grep -r "from '.*cli/" src/core/ src/remote/core/` should return nothing
