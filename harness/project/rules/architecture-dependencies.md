# Architecture Dependencies

## Goal

Prevent cross-layer and cross-module dependency violations that break the CLI/extension boundary or create circular imports.

## Repo Facts

- `src/core/` — pure Node.js utilities, no `vscode` import allowed
- `src/vscode/` — VSCode extension adapters/state (`settingsStore`, `workspaceResolver`, `logger`, `qtState`), may depend on `vscode`
- `src/qt/shared/` — pure Node.js logic shared between CLI and extension, no `vscode` import
- `src/qt/cli/` — Qt CLI entry, depends on `qt/shared/` and `core/`
- `src/cpp/cli/` — C++ CLI entry, depends on `cpp/` internals and `core/`
- `src/cli/` — unified CLI dispatcher, routes to `qt/cli/` or `cpp/cli/`
- `src/qt/` (non-shared, non-cli) — may import `vscode`
- `src/cpp/` (non-cli) — may import `vscode`
- `src/ui/` — VSCode UI layer, may import from `qt/`, `cpp/`, `core/`

## Core Rules

1. Dependency direction: `ui/ → qt/ | cpp/ → core/`; reverse is forbidden
2. `cpp/` and `qt/` must NOT import from each other
3. `core/` must NOT import from `qt/`, `cpp/`, or `ui/`
4. `core/`, `qt/shared/`, and CLI entries must NOT import `vscode`
5. CLI entries (`cli/`, `qt/cli/`, `cpp/cli/`) must NOT import `vscode`
6. Platform-specific code lives in `qt/platform/{win,linux}/` or `cpp/platform/`, never in `shared/`

## Design Checklist

- [ ] New module placed in correct layer per Module Placement table
- [ ] No upward or lateral dependency violation
- [ ] CLI-reusable logic in `shared/` or `core/`, not in vscode-dependent files

## Implementation Checklist

- [ ] No `import * as vscode` in `core/`, `qt/shared/`, or CLI files
- [ ] No `import ... from '../cpp/...'` in `qt/` or vice versa
- [ ] No circular dependency introduced (check with `tsc --noEmit`)

## Common Smells

- Importing `vscode` in a pure utility or "shared" file "just for types" — use a local interface instead
- Putting platform detection in `shared/` because "it's just an if-statement" — use `platform/`
- Creating a helper in `qt/` that `cpp/` also needs — move to `core/`
