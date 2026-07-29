---
name: test-result-field-consistency
description: Audit test assertions that reference result object fields — wrong field names create silent test gaps that pass without testing anything
source: auto-skill
extracted_at: '2026-07-02T05:52:25.818Z'
---

# Test Result Field Consistency

When tests access result object fields by name (e.g., `parsed.nextActions`), a field name mismatch between the code's actual output and the test's expectation creates a **silent test gap** — the test appears to run but the assertion never fires because the field is `undefined`.

## The Pattern

Code outputs: `{ nextAction: 'forja status --json' }` (singular string)
Test asserts: `assert.deepEqual(parsed.nextActions, ['forja status --json'])` (plural array)

Result: `parsed.nextActions` is `undefined`, `assert.deepEqual(undefined, [...])` fails — OR worse, if the test uses optional chaining like `listResult.nextActions?.find(...)`, the result is `undefined` and subsequent `if (remoteAction && ...)` silently skips all assertions.

## When This Applies

- After renaming a field in a result interface (e.g., `useTarget` → `useScope`)
- After changing a field from array to string or vice versa (e.g., `nextActions[]` → `nextAction`)
- When consolidating commands that had different result shapes
- When reviewing test files for a module you just changed

## Process

### 1. Identify All Result Field Names in Code

Grep for the actual field names used in result objects:
```bash
grep -n "nextAction" src/cli/commands/list.ts   # singular string
grep -n "nextActions" src/cli/commands/use.ts    # does it exist?
```

### 2. Find All Test References to Those Fields

```bash
grep -rn "parsed\.nextAction" src/test/
grep -rn "\.nextActions" src/test/
```

### 3. Cross-Reference

For each test field reference, verify:
- The field name matches what the code actually outputs
- The field type matches (string vs array vs object)
- Optional chaining (`?.`) isn't hiding a silent skip

### 4. Check for Silent Gaps

The most dangerous pattern:
```typescript
// This silently does nothing when nextActions doesn't exist
const action = result.nextActions?.find(a => a.includes('use remote'));
if (action && ...) {
    assert.ok(...);  // NEVER REACHED
}
```

Fix by using the correct field name:
```typescript
const action = result.nextAction;  // singular string
if (action && action.includes('use remote') && ...) {
    assert.ok(action.includes(name), ...);
}
```

## Real Examples From This Project

| Test file | Wrong field | Actual field | Impact |
|-----------|-------------|--------------|--------|
| `sdkCli.test.ts` (3 tests) | `parsed.nextActions` (array) | `parsed.nextAction` (string) | Hard failure — test caught it |
| `cliCommands.test.ts` | `listResult.nextActions?.find(...)` | `listResult.nextAction` (string) | **Silent gap** — test passed without testing anything |
| `qtCliBehavior.test.ts` | Expected 3 nextActions in output | Code produces 1 nextAction | Test expected aspirational behavior never implemented |

## Rules

- **After any result interface change, grep ALL test files** for the old field name
- **Beware optional chaining in tests** — `result.field?.method()` silently returns `undefined` when `field` doesn't exist
- **Beware conditional assertions** — `if (value) { assert(...) }` passes when `value` is `undefined` due to wrong field name
- **TypeScript won't catch this** — test files often use `JSON.parse()` which returns `any`, so field name typos compile fine
- **Run the tests** — compilation checks aren't enough; a test with a wrong field name compiles and may even pass
