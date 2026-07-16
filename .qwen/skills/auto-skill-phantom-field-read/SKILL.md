---
name: phantom-field-read
description: When code reads a field that doesn't exist on the declared type, the value is silently undefined — TypeScript may not catch it if the object comes from a function with a wider return type or a spread/fallback pattern
source: auto-skill
extracted_at: '2026-07-16T00:00:00.000Z'
---

# Phantom Field Reads

When code reads `obj.fieldName` but `fieldName` doesn't exist on the object's actual type, the result is silently `undefined`. TypeScript may not catch this if the object was constructed via fallback, spread, or a function that returns a wider type.

## The Bug Pattern

```typescript
interface ProjectSyncConfig {
    enabled: boolean;
    ignore: string[];
    // NOTE: no selectedServer, no remotePaths
}

// Consumer code reads fields that don't exist:
const sync = readProjectSyncConfig(workspace);  // returns ProjectSyncConfig
const serverId = sync.selectedServer;            // ← ALWAYS undefined!
const remotePath = sync.remotePaths[serverId];   // ← TypeError at runtime!
```

The code compiles because `readProjectSyncConfig` returns `ProjectSyncConfig` which TypeScript knows doesn't have `selectedServer`. But if the code uses a fallback spread:

```typescript
const sync = wsRoot
    ? readProjectSyncConfig(wsRoot)
    : { enabled: false, selectedServer: '', ignore: [...], remotePaths: {} };
//     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//     This fallback HAS the fields, but readProjectSyncConfig() does NOT
//     TypeScript infers the union type and may allow access
```

Now `sync.selectedServer` is `undefined` when coming from `readProjectSyncConfig()` but `''` when coming from the fallback — **inconsistent behavior that depends on which branch executes**.

## Why TypeScript May Not Catch This

1. **Union types from ternary/fallback**: `ProjectSyncConfig | { selectedServer: string, ... }` — TypeScript allows access to fields that exist on either branch
2. **Type widening through spread**: `{ ...syncConfig, selectedServer: '' }` creates a new type that has the field
3. **`as any` or implicit any**: Legacy code may use loose typing
4. **Interface evolution**: Fields were removed from the interface but consumers weren't updated

## Real Example: selectedServer Migration

`selectedServer` and `remotePaths` were migrated from `SyncSettings` to `RemoteSettings`. But 6+ consumer files still read `sync.selectedServer`:

- `ui/configPanel/templateData.ts` — config panel always showed empty sync server
- `ui/configPanel/index.ts` — same issue
- `cli/commands/sync.ts` — `forja sync status` showed no server
- `cli/commands/index.ts` — sync setup check always triggered
- `remote/core/plan.ts` — fallback logic masked the issue

The bug was **invisible** because:
- The fallback object in ternary expressions had the fields
- TypeScript's structural typing allowed the access
- The code path "worked" — it just always saw `undefined` for the server

## How to Find Phantom Reads

### After a field removal or migration:
```bash
# Find all reads of the removed field
grep -rn "\.selectedServer\|\.remotePaths" src/

# For each hit, verify the object's TYPE actually has the field
# Check the variable's declared type or the function's return type
```

### After an interface change:
```bash
# Find all consumers of the changed interface
grep -rn "InterfaceName" src/ | grep -v "test\|\.d\.ts"

# For each consumer, check if they access fields that no longer exist
```

### General audit:
```bash
# Look for spread patterns that add fields not in the base type
grep -rn "{ \.\.\..*,.*:" src/ | grep -v "test"
```

## Rules

1. **After removing a field from an interface, grep for ALL accesses** — not just direct uses, but also `obj.field`, destructuring, and spread patterns
2. **Fallback objects must match the function's return type** — if `readConfig()` returns `Config`, the fallback `{ ... }` must have exactly the same fields
3. **After a storage migration, audit ALL consumers** — don't just update the ones that fail to compile; some will silently read `undefined`
4. **Prefer explicit over spread** — `const x = { enabled: sync.enabled }` is safer than `const x = { ...sync }` because it forces you to declare which fields you need

## Audit Checklist

After removing or moving a field:

- [ ] `grep` for all accesses of the field name across `src/`
- [ ] For each access, verify the object's **declared type** (not just runtime value) has the field
- [ ] Check ternary/fallback patterns — does the fallback have the field but the function return type doesn't?
- [ ] Check destructuring patterns — `const { selectedServer } = sync` silently produces `undefined`
- [ ] Run `tsc --noEmit --strict` — strict mode catches more phantom accesses
- [ ] Test the actual runtime behavior — add a `console.log` to verify the value isn't always `undefined`
