---
name: flag-wiring-completeness
description: When adding flags to a CLI handler, verify they are extracted from argv AND passed through the full call chain to the function that uses them
source: auto-skill
extracted_at: '2026-07-05T08:08:50.624Z'
---

# Flag Wiring Completeness

When adding or modifying CLI flags, verify the flag is wired through the **entire chain**: known-flags set → extract from argv → pass to handler function → handler function accepts the parameter → handler function uses it.

## The Bug Pattern

A flag is added to the known-flags validation set (so it passes unknown-flag checks) but is never extracted from argv or never passed to the underlying function. The user provides the flag, it's silently ignored, and the command behaves as if the flag wasn't given.

```typescript
// index.ts: flag is recognized but never extracted
const useKnown = new Set(['--project', '--mode', '--qt-path']);  // --qt-path listed
const result = await runUseTarget(workspace, {
    project: extractFlag(argv, '--project'),
    mode: extractFlag(argv, '--mode'),
    // BUG: --qt-path never extracted, never passed
});

// use.ts: interface doesn't even have the field
interface UseTargetArgs {
    project?: string;
    mode?: string;
    // BUG: no qtPath field
}
```

The user runs `forja use target --qt-path /opt/Qt/6.5.0` and the path is silently ignored.

## The Fix — Trace the Full Chain

For every flag, verify all 5 layers:

```
1. known-flags set     → flag is listed (passes validation)
2. extract from argv   → extractFlag(argv, '--qt-path')
3. pass to handler     → runUseTarget(workspace, { qtPath: ... })
4. handler interface   → UseTargetArgs { qtPath?: string }
5. handler uses it     → resolveOpts.qtPath = options.qtPath
```

If any layer is missing, the flag is silently broken.

## Audit Checklist

After adding or modifying flags in a CLI handler:

- [ ] **Known-flags set**: Is the flag in `useKnown`/`useWithVal` (or equivalent)?
- [ ] **Extraction**: Is `extractFlag(argv, '--flag-name')` called?
- [ ] **Pass-through**: Is the extracted value passed to the handler function?
- [ ] **Interface**: Does the handler's argument interface have the field?
- [ ] **Usage**: Does the handler actually use the value (not just receive it)?
- [ ] **Type consistency**: If the flag value transforms between layers (e.g., file path string → parsed Record), is the conversion explicit?

## Common Variants

| Variant | Symptom | Example |
|---------|---------|---------|
| Flag in known-set but not extracted | Flag silently ignored | `--qt-path` in set, no `extractFlag` call |
| Flag extracted but not passed | Flag silently ignored | `extractFlag` called, but not in handler call |
| Flag passed but interface missing field | TypeScript error (if strict) or silently dropped | Handler call has `qtPath` but interface lacks it |
| Flag in interface but not used | Flag accepted but has no effect | Interface has `qtPath` but resolve functions ignore it |
| Type mismatch between layers | Runtime error or wrong behavior | Entry receives `string` (file path), internal expects `Record` |

## When to Apply

- After adding new flags to any CLI command
- After modifying an existing command's flag set
- During code review of CLI handlers
- When a user reports "I passed --flag but nothing happened"
