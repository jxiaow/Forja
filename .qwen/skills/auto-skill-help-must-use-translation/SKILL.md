---
name: help-must-use-translation
description: CLI entry point help text must use T() translation and load locale before display — never hardcode help strings in the entry point
source: auto-skill
extracted_at: '2026-07-06T07:17:14.282Z'
---

# Help Text Must Use Translation

CLI entry points that display `--help` output must use the `T()` translation system and load the user's locale before rendering help text. Never hardcode help strings in the entry point file.

## The Problem

`src/cli/index.ts` had its own `printHelp()` function with hardcoded English text. When the user ran `forja --help`, it hit this function BEFORE reaching `runCli()` which handles locale. Result: help was always English even after `forja use lang zh`.

## The Fix

```typescript
// WRONG: hardcoded help in entry point
function printHelp(): void {
    console.log(`Usage:\n  forja <command> ...`);  // Always English!
}

// RIGHT: use T() and load locale first
function printHelp(): void {
    console.log(`Forja v${VERSION}\n`);
    console.log(T('help.toplevel'));  // Translated!
}

async function main(argv: string[]): Promise<void> {
    // Load locale BEFORE help/version
    const globalConfig = loadGlobalConfig();
    const locale = resolveLocale(undefined, globalConfig.lang);
    setGlobalLocale(locale);

    if (!subcommand || subcommand === '--help') {
        printHelp();
        return;
    }
}
```

## Rules

1. All help text must be in the `T()` translation table (`types.ts`)
2. Entry points must call `setGlobalLocale()` BEFORE any `T()` call or help display
3. `--version` can be hardcoded (it's just a version string)
4. If the entry point intercepts `--help` before routing to the command dispatcher, it must still load locale first
5. Help text should use template literals (backtick strings) for readability, not `\n`-joined single-line strings
