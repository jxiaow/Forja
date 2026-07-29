# Platform Abstraction

## Goal

Keep platform-specific logic isolated so that cross-platform bugs don't leak into shared code and new platform support can be added without refactoring core logic.

## Repo Facts

- Qt platforms: `src/qt/platform/win/`, `src/qt/platform/linux/`
- Qt platform config: `src/qt/platform/platformConfig.ts` (factory/selector)
- Qt shell plan: `src/qt/platform/shellPlan.ts` (command composition)
- SDK platforms: `src/sdk/platform/` (windows/linux command generation)
- Environment detection: `src/qt/env/envDetector.ts`, `src/sdk/cli/envDetector.ts`
- Shared code (`qt/shared/`, `core/`) must be platform-agnostic

## Core Rules

1. Platform-specific code lives ONLY in `platform/` directories
2. `shared/` and `core/` must not contain `process.platform` checks or OS-specific paths
3. Platform selection happens at the boundary (caller picks the right platform module)
4. Path separators: use `path.join()` / `path.resolve()` — never hardcode `/` or `\\`
5. Shell commands: build via `shellPlan.ts` or platform builder, never string concatenation in business logic

## Design Checklist

- [ ] New platform-specific behavior has a corresponding file in `platform/{win,linux}/`
- [ ] Interface defined in parent `platform/` directory, implementations in subdirectories
- [ ] No `if (process.platform === 'win32')` in shared or core code

## Implementation Checklist

- [ ] Both win and linux implementations provided (or explicit "not supported" error)
- [ ] Path construction uses `path` module
- [ ] Shell commands tested on target platform or documented as single-platform

## Common Smells

- Adding `os.platform()` check in `qt/shared/commandRunner.ts` instead of using platform builder
- Hardcoding `cmd /c` or `bash -c` in non-platform files
- Using `\\` path separators in string literals
