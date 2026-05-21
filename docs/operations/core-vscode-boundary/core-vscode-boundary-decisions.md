# Decision Log

> Status date: 2026-05-21

This file records key conclusions, deferral reasons, and reopen conditions during the current initiative.

## DEC-001 Move VSCode Adapters To `src/vscode`

- Date: 2026-05-21
- Conclusion: VSCode-dependent adapter/state files live in `src/vscode/`; `src/core/` remains pure Node.
- Reason: CLI packaging and shared logic need a clear boundary that cannot accidentally pull in the VSCode API.
- Impact: Extension-side modules import `settingsStore`, `workspaceResolver`, `logger`, and `qtState` from `src/vscode/`; CLI/shared modules use `core` pure helpers such as `loggerBase` and `settingsIO`.
- Reopen condition: a future CLI/shared file needs a capability that only exists in `src/vscode/`.
