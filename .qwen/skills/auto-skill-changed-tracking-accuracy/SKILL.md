---
name: changed-tracking-accuracy
description: When reporting "changed fields", compare new values against previous state — don't list all non-empty fields as changed
source: auto-skill
extracted_at: '2026-07-06T02:07:47.642Z'
---

# Changed-Tracking Accuracy

When a save/write function returns a list of "changed" fields, it must compare new values against the **previous state** — not just list all fields that have values.

## Anti-pattern

```ts
// WRONG: lists every non-empty field as "changed"
const changed: string[] = [];
if (config.qtPath) changed.push('qtPath');
if (config.vsInstall) changed.push('vsInstall');
if (config.mode) changed.push('mode');
```

This reports fields as "changed" even when the user re-selected the same value.

## Correct pattern

```ts
// RIGHT: read old state before saving, only report actual diffs
const oldQt = loadQtSettings(workspace);
const oldTarget = loadActiveTarget(workspace);

// ... perform save ...

const changed: string[] = [];
if (config.qtPath && config.qtPath !== oldQt?.qtPath) changed.push('qtPath');
if (config.mode && config.mode !== oldTarget?.mode) changed.push('mode');
```

## Rules

1. **Read old state BEFORE writing** — save functions should load current values before overwriting
2. **Compare new vs old** — only push to `changed[]` when the new value differs from the old
3. **Handle first-time setup** — when no old state exists, all non-empty fields are genuinely new (all changed)
4. **Empty result is valid** — if nothing changed, return empty array (display as "无" / "none")

## Why

Users rely on "changed" to understand what the command actually did. Listing all non-empty fields makes it look like everything was reconfigured when nothing changed, eroding trust in the output.
