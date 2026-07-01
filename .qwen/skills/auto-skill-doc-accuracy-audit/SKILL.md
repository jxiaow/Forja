---
name: doc-accuracy-audit
description: Audit documentation against actual implementation, fix stale references, and create spec-compliance tests
source: auto-skill
extracted_at: '2026-06-26T08:34:27.287Z'
---

# Documentation Accuracy Audit

When tasked with updating API docs and verifying them with tests, follow this process to ensure documentation matches the actual implementation.

## When This Applies

- User asks to "完善 API 文档" or "update API docs"
- User asks to verify docs match implementation
- A major refactoring changed command names, flags, or output structures
- Tests need to be created or updated based on documentation

## Process

### 1. Map the Documentation Landscape

Identify all relevant doc files and their roles:
- **Authoritative spec** (e.g., `command-api.zh.md`) — the primary API contract
- **Migration/plan docs** (e.g., `v2/index.md`) — the design intent
- **Legacy/reference docs** (e.g., `cli-interface-spec.md`) — may be outdated
- **HTML renderings** — derived from markdown, update source first

### 2. Compare Docs Against Implementation

For each documented command/feature, check the actual source code:
- Command names (e.g., `init` vs `setup`)
- Flag lists and subcommands
- Result interface fields
- Error/diagnostic structures
- Help text and nextActions strings

Use grep to find all references to old/stale names across the codebase:
```
grep -r "old_command_name" src/
```

### 3. Fix Stale References in Code

Update ALL user-facing references, not just the docs:
- Error messages and nextActions in source files
- Help text in CLI entry points
- Translation strings (T() keys)
- Test assertions that check for old command names

**Key insight**: Stale references often hide in:
- `nextActions` arrays (e.g., `['forja init']` → `['forja setup']`)
- Help text examples
- Translation table entries
- Test files that assert on old command names

### 4. Update Documentation Files

Update docs in priority order:
1. **Authoritative spec** — complete rewrite if significantly diverged
2. **Migration/plan docs** — targeted edits for changed references
3. **Legacy/reference docs** — rewrite to reflect current state, add pointer to authoritative spec

When rewriting a doc, include:
- Current command surface (exact names from code)
- All flags and subcommands (from actual handler code)
- Result interface types (from actual TypeScript interfaces)
- Config file formats (from actual settingsIO code)

### 5. Create Spec-Compliance Tests

Write tests that verify the code matches the documented API contract:

```typescript
// Command surface completeness
test('CLI registers exactly N commands', () => {
    const src = source('src/cli/commands/index.ts');
    for (const cmd of expectedCommands) {
        assert.ok(src.includes(`'${cmd}'`));
    }
});

// No stale references
test('no stale `old_name` in user-facing strings', () => {
    for (const file of filesToCheck) {
        const content = source(file);
        assert.ok(!content.includes('old_name'));
    }
});

// Type structure matches docs
test('Diagnostic type includes fix field', () => {
    const src = source('src/cli/commands/types.ts');
    assert.match(src, /interface Diagnostic \{[\s\S]*?fix\?:\s*string/);
});

// Feature completeness
test('command supports all documented subcommands', () => {
    const src = source('src/cli/commands/use.ts');
    for (const fn of expectedFunctions) {
        assert.ok(src.includes(fn));
    }
});
```

### 6. Update Existing Tests That Break

When doc/code changes cause existing tests to fail:
- Update test assertions to match new command names/structures
- Don't just fix the new tests — fix ALL broken tests in the same pass
- Pre-existing failures (e.g., locale-dependent tests) should be noted but not necessarily fixed

## Key Principles

- **Code is the source of truth**: Docs must match what the code actually does, not what it was designed to do
- **Three-layer consistency**: Docs, code, and tests must all agree
- **Grep before editing**: Find ALL stale references before making changes
- **Test the contract**: Write tests that verify the API surface matches the spec, not just internal behavior
- **Batch related fixes**: Fix all stale references in one pass to avoid repeated compile/test cycles
- **nextActions UX**: Use user-friendly placeholders (`<name>` not `<id>`), only show optional params when actually required
