---
name: list-show-paths
description: List output must show paths/identifiers alongside labels — labels alone are ambiguous when multiple items share the same name
source: auto-skill
extracted_at: '2026-07-06T02:53:29.324Z'
---

# List Output Must Show Paths

When listing items that have both a display label and a path/identifier, always show both. Labels alone are ambiguous when multiple items share the same name.

## Bug Pattern: Label Only

```typescript
// BUG: only shows label, can't distinguish duplicates
for (const t of targets) {
    const marker = t.current ? ' *' : '';
    lines.push(`  ${t.label}${marker}`);
}
```

Output:
```
  cmake
  cmake
  cmake
  qt_linux_pc_client *
  qt_linux_pc_client
  qt_linux_pc_client
```

User can't tell which "cmake" or "qt_linux_pc_client" is which. They can't make an informed selection.

## Correct Pattern: Label + Path

```typescript
// CORRECT: show both label and path
for (const t of targets) {
    const marker = t.current ? ' *' : '';
    lines.push(`  ${t.label}${marker} — ${t.project}`);
}
```

Output:
```
  cmake — xyframework/bifrost/build/cmake/CMakeLists.txt
  cmake — xyframework/media_engine/build/cmake/CMakeLists.txt
  qt_linux_pc_client * — qt_client/qt_linux_pc_client/qt_linux_pc_client.pro
  qt_linux_pc_client — qt_client/.worktrees/bugfix/qt_linux_pc_client/CMakeLists.txt
```

Now the user can distinguish items and make an informed choice.

## Rules

1. **Always show path/identifier alongside label** — even if labels are currently unique, future additions may create duplicates. Defensive: always show both.

2. **Use a clear separator** — ` — ` (em dash with spaces) works well. Avoid ambiguous separators like spaces or commas.

3. **Path should be relative** — use workspace-relative paths, not absolute. Keeps output concise and portable.

4. **Apply to all list commands** — `list targets`, `list servers`, `list env`, etc. Any list that shows named items should include enough context to distinguish them.

## Why This Matters

- **Duplicate labels are common** — projects with same name in different directories, multiple CMakeLists.txt, etc.
- **Users need context to choose** — after seeing the list, users run `use target --project <path>`. They need to see the path to know which one to pick.
- **nextAction references paths** — if nextAction is `forja use target --project <name|path>`, the user needs to see paths in the list to know what to type.

## Audit Checklist

When reviewing list output formatters:

- [ ] Does each item show both label and path/identifier?
- [ ] Are paths relative (not absolute)?
- [ ] Is the separator clear and unambiguous?
- [ ] Can users distinguish items with duplicate labels?
