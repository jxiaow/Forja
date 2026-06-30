---
name: cli-build-script
description: When adding new files to core/ or shared modules, they must be added to scripts/build-cli.js file lists — the CLI package copies files individually, not by directory glob
source: auto-skill
extracted_at: '2026-06-25T16:10:14.284Z'
---

# CLI Build Script File Lists

The CLI package (`scripts/build-cli.js`) does NOT copy entire directories. It copies **individual files** listed in explicit arrays. When adding a new file to `core/`, `qt/shared/`, `qt/platform/`, `sdk/`, or `sync/`, it MUST be added to the corresponding file list array.

## File List Arrays

| Array | Directory | Example files |
|-------|-----------|---------------|
| `coreFiles` | `core/` | `settingsIO.js`, `ssh.js`, `sdkProjectScanner.js` |
| `syncFiles` | `sync/` | `cli.js` (only pure Node files, no vscode deps) |
| `platformFiles` | `qt/platform/` | excludes `builder.js` (depends on vscode) |
| `sdkFiles` | `sdk/` | `constants.js` (non-vscode only) |
| `qtBuildFiles` | `qt/build/` | `designer.js` (non-vscode only) |
| `rootFiles` | root | `version.js` |

## Symptom of Missing File

If a new file is not in the list, the CLI will crash at runtime with:
```
Error: Cannot find module '../../core/newModule'
Require stack:
- .../cli/commands/someCommand.js
```

The VSCode extension works fine (it uses `out/` directory with all compiled files), but the CLI package (`forja-cli-*.tgz`) is missing the file.

## Rule

After adding any new `.ts` file to `core/`, `qt/shared/`, `qt/platform/`, `sdk/`, or `sync/`:
1. Open `scripts/build-cli.js`
2. Find the appropriate array (`coreFiles`, `syncFiles`, etc.)
3. Add the compiled `.js` filename (e.g., `'core/newModule.js'`)
4. Verify: `npm run package:cli:dev` then `npm install -g` and test the CLI command that imports the new module
