---
name: cli-smart-suggestions
description: CLI error messages must use keyword substring matching to suggest correct commands when user input contains recognizable keywords
source: auto-skill
extracted_at: '2026-06-30T04:48:02.460Z'
---

# CLI Smart Suggestions

When a user types an incorrect command, subcommand, flag, or argument, the error message should suggest the correct option if the input contains a recognizable keyword.

## Core mechanism: substring matching

```typescript
function suggestCorrection(input: string, candidates: string[]): string | undefined {
    const lower = input.toLowerCase();
    for (const c of candidates) {
        const cLower = c.toLowerCase();
        if (cLower.includes(lower) || lower.includes(cLower)) {
            return c;
        }
    }
    return undefined;
}
```

No fuzzy/Levenshtein matching — only substring overlap. `mode` matches `--mode`, `target` matches `targets`, but `buid` does NOT match `build`.

## Keyword-to-command mapping

For cases where the user types a keyword that's a concept, not a command name, use a mapping table:

```typescript
const KEYWORD_SUGGESTIONS: Record<string, Record<string, string>> = {
    use: {
        'mode': 'forja use target --mode <debug|release>',
        'arch': 'forja use target --arch <x86|x64>',
        'project': 'forja use target --project <path>',
        'server': 'forja use remote --server <name>',
        'lang': 'forja use lang <zh|en>',
    },
};
```

Check the mapping FIRST, then fall back to substring matching against known subcommands.

## Apply at all error points

| Error type | Candidates to match against | Example |
|-----------|---------------------------|---------|
| Unknown command | All top-level commands | `forja buid` → no match (typo, not keyword) |
| Unknown subcommand | Valid subcommands + keyword map | `forja use mode` → `forja use target --mode` |
| Unknown flag | Known flags for that command | `forja status --process` → match if substring |
| Unknown list category | Valid categories | `forja list target` → `targets` |
| Unknown build action | Valid actions | `forja build fresh` → match if substring |

## Error message format

```typescript
const hint = suggestCorrection(input, candidates);
const msg = hint
    ? `${T('unknownX')}: ${input}. ${T('didYouMean')}: ${hint}?`
    : `${T('unknownX')}: ${input}`;
```

For unknown flags, use a helper that processes multiple flags:

```typescript
function unknownFlagsMessage(unknown: string[], knownFlags: Set<string>): string {
    // For each unknown flag, try substring match against known flags
    // Append "Did you mean: --correct-flag?" if match found
}
```

## Help text must be complete

When showing help (e.g., `forja use --help`), list ALL subcommands with their options — not just a few. Users need to see the full command surface to know what's available.

## Why

User typed `forja use mode` to change build mode. Error said "Unknown use subcommand: mode" with nextActions `['forja use target', 'forja use execution', 'forja use remote']` — none of which told the user that mode is set via `forja use target --mode`. The keyword `mode` appears in the correct command but the error didn't connect the dots.
