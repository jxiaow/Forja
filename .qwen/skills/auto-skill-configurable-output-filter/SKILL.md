---
name: configurable-output-filter
description: Build output warning suppression must be user-configurable via settings, not hardcoded warning codes — pass through RunOptions to executor
source: auto-skill
extracted_at: '2026-07-06T06:14:56.925Z'
---

# Configurable Build Output Filtering

When build output contains noisy compiler warnings that flood the terminal, the suppression mechanism must be user-configurable — never hardcode specific warning codes in the output filter.

## Anti-Pattern: Hardcoded Filter

```typescript
// BAD: hardcoded warning codes
const SUPPRESSED_WARNINGS = [/warning C4819:/];
function filterBuildOutput(text: string): string {
    return text.split('\n').filter(line => !SUPPRESSED_WARNINGS.some(re => re.test(line))).join('\n');
}
```

## Correct: User-Configurable via Settings

1. Add `suppressedWarnings?: string[]` to settings interface (e.g., `QtSettings`)
2. Pass through `RunOptions.suppressedWarnings` to the executor
3. Filter at execution time using substring matching on warning codes

```typescript
// Settings
interface QtSettings {
    suppressedWarnings?: string[];  // e.g., ['C4819', 'C5297']
}

// RunOptions
interface RunOptions {
    suppressedWarnings?: string[];
}

// Filter function — bounded match on user-provided codes
function filterBuildOutput(text: string, suppressed?: string[]): string {
    if (!suppressed || suppressed.length === 0) return text;
    return text.split('\n')
        .filter(line => !suppressed.some(code => line.includes(` ${code}:`) || line.includes(` ${code} `)))
        .join('\n');
}
```

## Data Flow

```
QtSettings.suppressedWarnings
  → build.ts reads from loadQtSettings()
  → passed to runCliResult(plan, { suppressedWarnings })
  → RunOptions.suppressedWarnings
  → executeStreaming() / execute() filter each chunk
```

## CLI Configuration

Provide a flag to set suppressed warnings:

```
forja use target --suppress-warnings C4819,C5297
```

This writes the codes to settings. Comma-separated, trimmed, stored as `string[]`.

## Rules

1. **Never hardcode warning codes** — all filtering must come from user configuration
2. **Bounded matching** — match ` ${code}:` or ` ${code} ` to avoid over-filtering (e.g., "C48" must not match "C4819")
3. **Pass through options, not globals** — use `RunOptions` parameter, not module-level state
4. **Filter both streaming and non-streaming** — apply to `execute()` and `executeStreaming()`
5. **Settings-level config** — store in workspace settings (QtSettings), not global config
6. **Empty by default** — no warnings suppressed unless user explicitly configures it
