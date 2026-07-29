---
name: cli-path-quoting
description: CLI list output must quote paths containing spaces and place them at end of line for easy copy-paste
source: auto-skill
extracted_at: '2026-07-06T03:30:35.596Z'
---

# CLI Path Quoting for Copy-Paste

When CLI commands display file paths that users will copy-paste into other commands (e.g., `forja list env`, `forja list targets`), paths must be formatted for easy selection and correct shell parsing.

## Problem

```
  可用:
    C:\Program Files\Microsoft Visual Studio\2022\Community (2022) [Community]
```

User copies the path → pastes into `forja use target --vs C:\Program Files\...` → shell splits at spaces → only `C:\Program` is used.

## Solution: Quote + Path Last

```
  可用:
    (2022) [Community]  "C:\Program Files\Microsoft Visual Studio\2022\Community"
```

## Rules

1. **Quote paths with spaces** — Use a `quotePath()` helper: `p.includes(' ') ? '"' + p + '"' : p`
2. **Path at end of line** — Put version/edition/label metadata BEFORE the path, so the path is the last thing on the line. Users can select from cursor to end-of-line.
3. **Apply to all path displays** — `list env qt`, `list env vs`, `list env jom`, `list env` (full), and any other command that shows file paths
4. **Merge configured/available into one list** — Don't show separate "已配置" and "可用" sections. Instead, show a single list with `* ` prefix for configured items. This avoids the confusion of "why does a detection command show configuration?"

## Merged List Pattern

```
环境 — VS
  * (2026) [Community]  "C:\Program Files\Microsoft Visual Studio\18\Community"
    (2022) [Community]  "C:\Program Files\Microsoft Visual Studio\2022\Community"
```

Instead of:
```
  已配置:
    "C:\Program Files\Microsoft Visual Studio\18\Community"
  可用:
    (2026) [Community]  "C:\Program Files\Microsoft Visual Studio\18\Community"
    (2022) [Community]  "C:\Program Files\Microsoft Visual Studio\2022\Community"
```

For JSON output, merge into a single array with `configured: true` on matching items:
```json
"vs": [
  { "path": "...", "version": "2026", "edition": "Community", "configured": true },
  { "path": "...", "version": "2022", "edition": "Community" }
]
```

## Implementation

```typescript
function quotePath(p: string): string {
    return p.includes(' ') ? `"${p}"` : p;
}

// Format: metadata first, path last
const ver = version ? `(${version})` : '';
const ed = edition ? `[${edition}]` : '';
const tag = [ver, ed].filter(Boolean).join(' ');
lines.push(`    ${tag ? tag + '  ' : ''}${quotePath(path)}`);
```

## Audit Checklist

- [ ] All file paths in list output go through `quotePath()`?
- [ ] Is the path the last element on each line?
- [ ] Can the user copy the path and paste it directly into a `--flag` argument?
