---
name: sdk-intellisense
description: SDK IntelliSense must parse .vcxproj for include paths — never use directory scanning. Qt and SDK configs coexist in one c_cpp_properties.json with different names.
source: auto-skill
extracted_at: '2026-06-25T09:32:13.188Z'
---

# SDK IntelliSense Generation

## Core Principle: Parse Project Files, Don't Scan Directories

For SDK (.sln/.vcxproj) projects, **always parse the project files** to extract include paths and preprocessor definitions. Never use directory scanning (looking for .h files) — it produces inaccurate results because .sln files are often in build output directories far from the actual source.

## Parsing Pipeline

```
.sln file
  → regex: Project("...") = "Name", "path\to\project.vcxproj", "{GUID}"
  → resolve relative .vcxproj paths to absolute (relative to .sln directory)
  → for each .vcxproj:
    → find ItemDefinitionGroup with matching Configuration|Platform
    → extract AdditionalIncludeDirectories (semicolon-separated relative paths)
    → extract PreprocessorDefinitions (semicolon-separated defines)
    → resolve include paths relative to .vcxproj directory → absolute paths
  → merge all includes/defines across all .vcxproj files
  → deduplicate
```

## Implementation

**`generateSdkCppProperties(slnPath, wsRoot)`** in `src/qt/build/configGenerator.ts`:

1. `parseVcxprojFromSln(slnPath)` — regex parse .sln for .vcxproj paths
2. `parseVcxprojIncludes(vcxprojPath, arch)` — regex parse .vcxproj for includes/defines
3. Resolve relative paths: `path.resolve(vcxprojDir, relativePath)`
4. Filter out MSBuild variable references (`$(...)`, `%(...)`)
5. Fallback: if no includes parsed, use .sln directory

## Configuration Naming

Qt and SDK configurations **coexist** in the same `c_cpp_properties.json` using different names:

```json
{
    "configurations": [
        { "name": "Qt x86", ... },
        { "name": "SDK x86", ... }
    ],
    "version": 4
}
```

Use `mergeCppConfiguration(vscodeDir, name, config)` to read existing file, find configuration by name, update or append, and write back. **Never overwrite the entire file** — that would destroy the other configuration.

## Trigger Points

IntelliSense generation must be triggered from ALL of these locations, for BOTH Qt and SDK:

| Trigger | Qt | SDK | Location |
|---------|----|----|----------|
| Target selection | `generateCppProperties(info)` | `generateSdkCppProperties(slnPath, ws)` | `forja._selectTarget` in commands.ts |
| Config panel | `generateCppProperties(project)` | `generateSdkCppProperties(slnPath, ws)` | `messageHandler.ts` `generateIntelliSense` case |
| Startup | `generateCppProperties(project)` | — (wait for target selection) | `extension.ts` |

**Critical**: The config panel handler must check `activeTarget.kind` to decide which generator to call. Don't assume Qt.

## Output Location

Always write to the **VSCode workspace folder** root:
```typescript
const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || fallbackWsRoot;
const vscodeDir = path.join(wsRoot, '.vscode');
```

Never use `getWorkspaceRoot()` alone — it defaults to Qt workspace which may be unconfigured.

## Common Pitfalls

- **Directory scanning from .sln directory**: .sln files are often in `build/win/ProjectName/` — scanning from there finds nothing useful. Always parse .vcxproj.
- **Overwriting c_cpp_properties.json**: If you write a fresh file for SDK, you destroy the Qt configuration. Always use merge writing.
- **Hardcoded configuration names**: Use `"Qt x86"` / `"SDK x86"` (or x64), not just `"Win32"` / `"x64"` — the latter causes conflicts between Qt and SDK.
- **Missing .vcxproj fallback**: If .sln references .vcxproj files that don't exist on disk, skip them silently. If NO .vcxproj files are found, fallback to .sln directory as include path.
