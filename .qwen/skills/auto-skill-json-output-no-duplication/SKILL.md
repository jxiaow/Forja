---
name: json-output-no-duplication
description: JSON API responses must not duplicate data across fields — strip internal fields, merge related data, each fact appears in exactly one place
source: auto-skill
extracted_at: '2026-07-06T03:39:42.522Z'
---

# JSON Output — No Field Duplication

JSON API responses must not repeat the same data in multiple fields. Each fact should appear in exactly one place. Internal implementation details must be stripped from output. If a summary section only repeats data from another field, remove it entirely.

## Anti-Pattern: Same Data in Multiple Fields

```json
{
  "activeTarget": {
    "kind": "sdk",                    ← internal field, user doesn't choose this
    "vsInstall": "C:\\Program Files\\...",
    "runAt": "local"
  },
  "toolchain": {
    "vs": {
      "path": "C:\\Program Files\\...",  ← duplicate of activeTarget.vsInstall
      "version": "2022"
    }
  },
  "runtime": {
    "running": false,
    "runAt": "local"                     ← duplicate of activeTarget.runAt
  }
}
```

## Correct: Each Fact in One Place, Merge Related Data

```json
{
  "activeTarget": {
    "project": "cpp-sdk/build/win/NemoSDK/NemoSDK.sln",
    "mode": "release",
    "arch": "x86",
    "runAt": "local",
    "vsInstall": "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community",
    "vsVersion": "2022"
  },
  "runtime": {
    "running": false
  }
}
```

Note: `toolchain` section was removed entirely — its only unique info (version) was merged into `activeTarget` as `vsVersion`.

## Rules

1. **Strip internal fields** — Fields like `kind` that are implementation details (auto-detected from file extension) should not appear in output. Use destructuring to remove: `const { kind: _kind, ...rest } = target;`
2. **Don't repeat config paths** — If `activeTarget.vsInstall` already has the VS path, don't repeat it elsewhere
3. **Don't repeat state across sections** — If `activeTarget.runAt` shows `"local"`, `runtime` shouldn't also have `runAt`
4. **Merge instead of separate sections** — If a summary section (like `toolchain`) only adds version info to paths already in another field, merge the version into that field (e.g., `vsVersion`) and remove the section entirely
5. **A section must add net-new information** — if all its data is derivable from other fields, remove it

## Audit Checklist

When reviewing a JSON response:
- [ ] Does any value appear in two or more fields?
- [ ] Are there internal/implementation fields leaking into output?
- [ ] Does each section add information not available elsewhere?
- [ ] Could a section be merged into another field (e.g., version → versionField)?
- [ ] Could a consumer get all needed info without cross-referencing duplicate fields?
