---
name: ok-level-consistency
description: Result envelope ok field and diagnostic level must be semantically consistent — ok:false + level:info is a contradiction that confuses consumers
source: auto-skill
extracted_at: '2026-07-15T14:15:54.136Z'
---

# OK / Diagnostic Level Consistency

The `ok` field on a result envelope and the `level` of its diagnostics must be semantically consistent. A result with `ok: false` signals failure — all its diagnostics should be `error` or `warning`. A diagnostic with `level: 'info'` signals a non-error status — the result should be `ok: true`.

## The Bug Pattern

```typescript
// BUG: ok:false says "failure" but level:'info' says "just FYI"
return {
    ok: false,
    action: 'init',
    diagnostics: [{ level: 'info', message: T('workrootAlreadyRegistered') }],
    questions,
    nextAction: 'forja init --answers <answers.json>',
};
```

AI agents and scripts check `result.ok` to decide success/failure. When `ok: false` but the diagnostic is `info`, the consumer doesn't know whether something actually failed or just needs input.

## Common Variants Found in Review

| Command | Pattern | Issue |
|---------|---------|-------|
| `init` | `ok: false` + `level: 'info'` for "workroot already registered" | Not an error — needs input |
| `use` | `ok: false` + `level: 'info'` for "no active target selected" | Not an error — state query |
| `status` | `ok: true` with `readiness.target = 'not-selected'` | Debatable — target not selected IS a problem for build |

## Correct Patterns

### "Needs Input" — use a status field, not ok:false

```typescript
// GOOD: clearly signals "not failed, just needs input"
return {
    ok: true,  // nothing went wrong
    action: 'init',
    status: 'needs-input',
    questions: [...],
    nextAction: 'forja init --answers <answers.json>',
};
```

### "State Query with No Data" — ok:true with info diagnostic

```typescript
// GOOD: query succeeded, just no data to show
return {
    ok: true,
    action: 'use',
    useScope: 'show',
    changed: [],
    diagnostics: [{ level: 'info', message: T('use.noActiveTargetSelected') }],
    nextAction: 'forja use target',
};
```

### "Real Failure" — ok:false with error diagnostic

```typescript
// GOOD: actual failure
return {
    ok: false,
    action: 'init',
    diagnostics: [{ level: 'error', message: T('init.noProjectsFound') }],
};
```

## Rules

1. **`ok: false` requires at least one `error`-level diagnostic** — if all diagnostics are `info` or `warning`, the result should be `ok: true`
2. **`level: 'info'` diagnostics should never appear in `ok: false` results** — info means "status update", not "failure reason"
3. **"Needs input" is not a failure** — use `status: 'needs-input'` or `ok: true` with questions, not `ok: false`
4. **"No data found" is not a failure** — a query that returns empty results succeeded; use `ok: true` with an info diagnostic

## Audit Checklist

- [ ] For every `ok: false` return: does it have at least one `error`-level diagnostic?
- [ ] For every `level: 'info'` diagnostic: is the enclosing result `ok: true`?
- [ ] Are "needs input" scenarios using `ok: false`? → Change to `ok: true` + `status: 'needs-input'`
- [ ] Are "no data" scenarios using `ok: false`? → Change to `ok: true` + info diagnostic
