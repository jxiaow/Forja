---
name: project-name-resolution
description: When list displays project labels but commands need file paths, resolve user input by matching against candidate labels
source: auto-skill
extracted_at: '2026-06-30T04:48:02.460Z'
---

# Project Name Resolution

When `list targets` shows display names (labels) like `qtpromise` but `use target --project` requires file paths like `qtpromise/qtpromise.pro`, the command must resolve names to paths automatically.

## Pattern

In `runUseTarget`, before checking `fs.existsSync`:

```typescript
let resolvedProject = args.project;
const projectPath = path.isAbsolute(resolvedProject) ? resolvedProject : path.join(workspace, resolvedProject);

// If not an existing file, try label matching
if (!fs.existsSync(projectPath) || fs.statSync(projectPath).isDirectory()) {
    const candidates = collectTargetCandidates(workspace);
    const inputLower = path.basename(resolvedProject).toLowerCase();
    const matches = candidates.filter(c => c.label.toLowerCase() === inputLower);
    
    if (matches.length === 1) {
        resolvedProject = matches[0].project;  // e.g., 'qtpromise/qtpromise.pro'
    } else if (matches.length > 1) {
        // Ambiguous — show all matches
        return error(`${T('projectNotFound')}: ${args.project}. Did you mean: ${matches.map(m => m.project).join(', ')}?`);
    }
}
```

## Key points

1. **Use `collectTargetCandidates`** — same function that powers `list targets`, so labels always match
2. **Case-insensitive matching** — `qtpromise` matches `QtPromise`
3. **Single match → auto-resolve** — user types `qtpromise`, gets `qtpromise/qtpromise.pro`
4. **Multiple matches → list options** — user picks from suggestions
5. **No match → original error** — falls through to "project not found"
6. **All downstream code uses `resolvedProject`** — not `args.project` — for path checks, extension inference, and saving config

## Why

User ran `forja list targets` which showed `qt  qtpromise`. Then typed `forja use target --project qtpromise` which failed with "Project file not found: qtpromise" because the code expected a file path, not a display name. The list output and the command input were speaking different languages.
