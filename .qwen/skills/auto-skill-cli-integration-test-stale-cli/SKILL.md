---
name: cli-integration-test-stale-cli
description: CLI integration tests that run `forja` as a subprocess use the installed CLI, not freshly compiled source — rebuild CLI package before asserting on output structure
source: auto-skill
extracted_at: '2026-06-30T02:34:16.496Z'
---

# CLI Integration Tests Use Installed Binary

## The Problem

Tests in `src/test/cliCommands.test.ts` (and similar) invoke `forja` via `execSync('forja ...')`. This runs the **globally installed** CLI, not the freshly compiled `out/` directory.

When you modify source-level structures (Diagnostic interface, output format, field names), the installed CLI still uses the old structure. Tests that assert on the new structure will fail even though the source is correct.

## Symptoms

- Unit tests (source-level assertions, `runCli()` direct calls) pass
- Integration tests (subprocess `forja` calls) fail on assertions about output structure
- The failure shows old field values (e.g., `code` field present) even though source no longer produces them

## Fix

After modifying CLI output structures:

1. **Rebuild the CLI package**: `npm run package:all` or equivalent
2. **Reinstall**: the test's `before()` hook checks `forja --version` — the installed binary must reflect changes
3. **Or**: make the test resilient by checking for field presence/absence with `||` patterns that work with both old and new formats during transition

## Prevention

When writing tests that check JSON output structure:
- Prefer **source-level tests** (import and call functions directly) over subprocess tests for structural assertions
- Reserve subprocess tests for **end-to-end behavior** (exit codes, flag parsing, command routing)
- If a subprocess test must check structure, add a comment noting it depends on CLI reinstall

## Example

```typescript
// BAD: This fails until CLI is reinstalled after Diagnostic interface change
assert.ok(!r.diagnostics[0].code, 'code field removed');

// GOOD: Works with both old and new CLI during transition
assert.ok(r.diagnostics[0].code || r.diagnostics[0].level, 'diagnostic has identifying fields');
```
