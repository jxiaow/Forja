---
name: bulk-code-transform
description: When facing 10+ repetitive code changes across multiple files, write a Node.js transform script instead of manual edits or agents that may time out
source: auto-skill
extracted_at: '2026-06-30T03:05:56.523Z'
---

# Bulk Code Transformation via Script

## When to Use

- 10+ similar mechanical changes across multiple files (e.g., removing a field from all objects, renaming a pattern, adding i18n keys)
- Agent-based edits time out or fail on repetitive tasks
- Manual edit tool calls would be error-prone due to volume

## Pattern A: Simple String Replacement

For mechanical renames, field removals, or literal substitutions:

```javascript
const fs = require('fs');
const path = require('path');

const replacements = {
  'src/cli/commands/file1.ts': [
    [`oldPattern1`, `newPattern1`],
    [`oldPattern2`, `newPattern2`],
  ],
};

const root = path.resolve(__dirname, '..');
for (const [relFile, reps] of Object.entries(replacements)) {
  const filePath = path.join(root, relFile);
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [oldStr, newStr] of reps) {
    content = content.split(oldStr).join(newStr);
  }
  fs.writeFileSync(filePath, content, 'utf8');
}
```

## Pattern B: Type-Level Refactoring (e.g., `T[]` → `T`)

When changing a type definition that propagates through the codebase (e.g., `nextActions: string[]` → `nextAction: string`), simple string replacement is insufficient. The transform must handle multiple code patterns:

### Step 1: Change type definitions first

```javascript
// Type declarations
content = content.replace(/nextActions:\s*string\[\]/g, 'nextAction?: string');
content = content.replace(/nextActions\?:\s*string\[\]/g, 'nextAction?: string');
```

### Step 2: Handle all usage patterns via regex

```javascript
// Object literals: nextActions: ['value'] → nextAction: 'value'
content = content.replace(/nextActions:\s*\['([^']*)'\]/g, "nextAction: '$1'");

// Multi-item arrays: nextActions: ['a', 'b'] → nextAction: 'a' (take first)
content = content.replace(/nextActions:\s*\['([^']+)',\s*(?:'[^\']*')+]/g, "nextAction: '$1'");

// Local variables: const x: string[] = [] → let x: string | undefined
content = content.replace(/const nextActions:\s*string\[\]\s*=\s*\[\]/g, 'let nextAction: string | undefined');

// Array push: nextActions.push(x) → nextAction = x
content = content.replace(/nextActions\.push\(([^)]+)\);?\s*$/gm, 'nextAction = $1;');

// Iteration: for (const a of x.nextActions) → if (x.nextAction) { const a = x.nextAction;
content = content.replace(/for\s*\(const\s+(\w+)\s+of\s+([\w.]+)\.nextActions\)\s*\{/g,
    'if ($2.nextAction) {\n        const $1 = $2.nextAction;');

// Length checks: x.nextActions?.length → x.nextAction
content = content.replace(/\.nextActions\?\.length/g, '.nextAction');

// Array methods: x.nextActions.includes(y) → x.nextAction === y
content = content.replace(/\.nextActions\.includes\(([^)]+)\)/g, '.nextAction === $1');

// Property access: x.nextActions → x.nextAction
content = content.replace(/\.nextActions\b/g, '.nextAction');
```

### Step 3: Compile, fix remaining, recompile

```bash
node scripts/transform-xxx.js    # Apply bulk transform
npx tsc --noEmit                 # Expect 20-50% of errors resolved
```

### Step 4: Parallel agents for remaining errors

Group remaining errors by directory and dispatch 2-3 agents:
```
Agent 1: src/sync/ (most errors)
Agent 2: src/remote/ + src/vscode/
Agent 3: src/cli/ + src/qt/ + src/sdk/ + tests
```

Each agent reads its files, fixes all patterns, writes back. Then final compile check.

## Key Lessons

- **Type refactoring is NOT simple rename**: Changing `T[]` → `T` requires handling 10+ distinct code patterns (type defs, object literals, array ops, iteration, function params, test assertions). A single regex won't cover everything.
- **Expect partial success**: First transform pass will miss 30-50% of patterns due to formatting variations. Compile → fix → recompile is the expected workflow.
- **Parallel agents for cleanup**: After the bulk transform, remaining errors are complex cases that need human-like understanding. Group by directory and dispatch 2-3 agents (not 4+ — they may all time out).
- **Exact string matching for simple cases**: Use `split(old).join(new)` for literal replacements. Use regex only when patterns have variable parts.
- **Count and report**: Always print per-file and total replacement counts.
- **Compile before test**: Run `tsc --noEmit` first to catch type errors before the slower test suite.
- **Test assertions need special handling**: `assert.deepEqual(x.nextActions, ['val'])` → `assert.equal(x.nextAction, 'val')`. `assert.ok(x.nextActions.some(a => regex.test(a)))` → `assert.ok(x.nextAction && regex.test(x.nextAction))`.
- **Multi-item arrays**: When collapsing `['a', 'b', 'c']` → single value, take the first item. Document this decision.

## Pattern C: Bulk Identifier Rename with Exceptions

When renaming identifiers across the entire codebase (e.g., `sdk` → `cpp`), some occurrences must NOT be renamed (false positives). Build an exception list:

```javascript
// Patterns that must NOT be renamed
const SKIP_PATTERNS = [
  /detectSdkVersion/i,   // Windows SDK, not project type
  /sdkRoot/i,            // Windows SDK path
  /NemoSDK/,             // Third-party library
];

function shouldSkipLine(line) {
  return SKIP_PATTERNS.some(p => p.test(line));
}

// Process line-by-line, skipping exception lines
for (const line of lines) {
  if (shouldSkipLine(line)) { result.push(line); continue; }
  let processed = line;
  for (const [from, to] of REPLACEMENTS) {
    while (processed.includes(from)) processed = processed.replace(from, to);
  }
  result.push(processed);
}
```

### Rename checklist:
1. **Enumerate all identifiers**: types, functions, fields, variables, string literals, file names, directory names
2. **Build exception list**: grep for the term, identify false positives (third-party, OS-level, different concept)
3. **Order replacements**: longer/more-specific first to avoid partial matches (`sdkModulePrefs` before `sdk`)
4. **Handle import paths**: `'../sdk/...'` → `'../cpp/...'`
5. **Rename files/directories**: after content changes, `fs.renameSync` for files and directories
6. **Watch for collisions**: two different symbols may map to the same name after rename — compile to catch
7. **Update build scripts**: `scripts/build-cli.js` file lists, glob patterns, keywords

## Examples from this project

- **Diagnostic `code` removal**: 131 occurrences across 6 files + type definition + tests (Pattern A)
- **i18n conversion**: 93 hardcoded English messages → T() calls + 88 translation keys (Pattern A)
- **nextActions: string[] → nextAction: string**: 244 occurrences across 41 files, 10+ pattern categories (Pattern B)
- **SDK → CPP rename**: ~905 occurrences across 45 files + 7 file renames + directory rename, with Windows SDK exception list (Pattern C)
