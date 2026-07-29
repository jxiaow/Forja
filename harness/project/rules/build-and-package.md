# Build and Package

## Goal

Prevent broken builds, incomplete packages, and version drift by enforcing the correct command sequences.

## Repo Facts

- Compile: `npm run compile` → `tsc -p ./ && copy-html`
- Test: `npm test` → compile + `node --test out/test`
- Package all: `npm run package:all` → bump version + .vsix + CLI .tgz
- Package extension only: `npm run package` → compile + vsce package
- Package CLI only: `npm run package:cli` → compile + build-cli.js
- Build CLI (no tgz): `npm run build:cli` → compile + build-cli.js (assemble only)
- Output: `out/` (compiled JS), `dist/` (packaged artifacts)
- `.vscodeignore` controls what goes into .vsix

## Core Rules

1. "打包" = `npm run package:all`; never substitute with `npm run compile`
2. Never call `scripts/build-cli.js` or `scripts/package-vs.js` directly — use npm scripts
3. Version bumping happens only through `npm run package:all` (calls `bump-version.js`)
4. CLI package depends on `out/` being up-to-date; always compile first
5. `.vscodeignore` must exclude: `src/`, `scripts/`, `docs/`, `node_modules/`, `AGENTS.md`, `skills/`, `harness/`

## Design Checklist

- [ ] New source files will be included in correct package (extension vs CLI vs both)
- [ ] New HTML/asset files have a copy step in build if needed

## Implementation Checklist

- [ ] `npm run compile` succeeds without errors
- [ ] `npm test` passes
- [ ] If CLI-relevant: `npm run build:cli` produces expected files in `cli/out/`
- [ ] `.vscodeignore` updated if new top-level directories added

## Common Smells

- Running `tsc` directly instead of `npm run compile` (misses copy-html step)
- Adding a file to CLI but not updating `scripts/build-cli.js` file list
- Forgetting to exclude new directories from `.vscodeignore`
