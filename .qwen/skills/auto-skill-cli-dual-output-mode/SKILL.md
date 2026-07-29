---
name: cli-dual-output-mode
description: Every CLI command must output human-readable text without --json and JSON with --json — no command may fall through to JSON in text mode
source: auto-skill
extracted_at: '2026-06-24T08:06:06.512Z'
---

# CLI Dual Output Mode

Every CLI command must support two output modes:
- **With `--json`**: structured JSON via `outputResult(result, wantsJson=true, formatter)`
- **Without `--json`**: human-readable text via the formatter's text branch

No command may ever output raw JSON when `--json` is not specified.

## Architecture

### `outputResult()` fallback must NOT be JSON

The central `outputResult()` function in `src/cli/commands/index.ts` must have a **text fallback** when no formatter is provided and `wantsJson` is false. The fallback generates readable text from `diagnostics` and `nextActions`. This ensures error paths (which often don't pass a formatter) never leak JSON to the terminal.

```typescript
function outputResult(result, wantsJson, textFormatter?) {
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else if (textFormatter) {
        console.log(textFormatter(result));
    } else {
        // Generic text fallback — NOT JSON
        const lines = [];
        if (!result.ok) lines.push('Error');
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                if (d) lines.push(d.message);
            }
        }
        if (result.nextActions?.length) {
            lines.push('Next:');
            for (const a of result.nextActions) lines.push(`  ${a}`);
        }
        console.log(lines.length > 0 ? lines.join('\n') : JSON.stringify(result, null, 2));
    }
    if (!result.ok) process.exitCode = 1;
}
```

### Every command needs a text formatter function

Each command file exports a `format*Text(result)` function that converts the command's result type to human-readable text:

| Command | Formatter | File |
|---------|-----------|------|
| status | `formatStatusText()` | `status.ts` |
| init | `formatInitText()` | `init.ts` |
| list | `formatListText()` | `list.ts` |
| use | `formatUseText()` | `use.ts` |
| server | `formatServerText()` | `server.ts` |
| build | `outputBuildResult()` | `build.ts` (own output function) |
| run | `outputRunResult()` | `run.ts` (own output function) |
| stop | `outputStopResult()` | `stop.ts` (own output function) |
| clean | `outputCleanResult()` | `clean.ts` (own output function) |
| doctor | `formatDoctorText()` | `doctor.ts` |
| sync | `formatSyncText()` | `sync.ts` |

### Dispatcher passes formatter to outputResult

In the dispatcher (`index.ts`), each handler's success path passes the formatter:

```typescript
outputResult(result, wantsJson, (r) => formatListText(r as Parameters<typeof formatListText>[0], locale));
```

The `as Parameters<typeof ...>[0]` cast is needed because `outputResult`'s formatter parameter is typed `(r: unknown) => string` for flexibility, but each specific formatter expects its own result type.

### Locale / i18n

All text formatters accept a `locale: Locale` parameter (`'en' | 'zh'`). Locale is resolved **once** at the top of `runCli()`:

```typescript
const globalConfig = loadGlobalConfig();
const locale = resolveLocale(extractFlag(argv, '--lang'), globalConfig.lang);
```

Resolution priority: `--lang` flag → **global config** (`~/.forja/config.json` `lang` field) → `FORJA_LANG` env var → system locale.

System locale detection uses `LC_ALL`/`LANG` env vars first, then falls back to `Intl.DateTimeFormat().resolvedOptions().locale` for Windows (where `LC_ALL`/`LANG` are typically not set):

```typescript
export function resolveLocale(langFlag?: string, storedLang?: string): Locale {
    if (langFlag === 'zh' || langFlag === 'en') { return langFlag; }
    if (storedLang === 'zh' || storedLang === 'en') { return storedLang; }
    const envLang = process.env.FORJA_LANG;
    if (envLang === 'zh' || envLang === 'en') { return envLang; }
    const sysLocale = (process.env.LC_ALL || process.env.LANG || '').toLowerCase();
    if (sysLocale.includes('zh')) { return 'zh'; }
    try {
        const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
        if (intlLocale.startsWith('zh')) { return 'zh'; }
    } catch { /* ignore */ }
    return 'en';
}
```

Users set language persistently with:
```bash
forja use lang zh    # set to Chinese, persists across sessions
forja use lang en    # set to English
forja use lang       # show current language
```

The global config is stored at `~/.forja/config.json` via `loadGlobalConfig()`/`saveGlobalConfig()` in `core/settingsIO.ts`.

`--lang` is in `GLOBAL_FLAGS` so all commands accept it. The locale is passed as a parameter to every handler, then to every formatter.

**Translation function** `T(key, locale)` in `types.ts` maps keys to bilingual strings:

```typescript
const UI: Record<string, { en: string; zh: string }> = {
    error:    { en: 'Error',   zh: '错误' },
    next:     { en: 'Next:',   zh: '后续：' },
    // ...70+ entries
};
export function T(key: string, locale: Locale): string {
    const entry = UI[key];
    return entry ? entry[locale] : key;
}
```

All user-visible strings in formatters (labels, status text, section headers) use `T()` instead of hardcoded English.

### Diagnostic messages and hints must also use T()

Not only formatter labels — the `message:` and `hint:` fields in `Diagnostic` objects created by business logic functions (e.g. `assessTargetReadiness`, `assessToolchainReadiness`) must also use `T()`. This requires passing `locale` into those functions:

```typescript
// BAD: hardcoded English
diagnostics.push({ code: 'toolchain.qtMissing', level: 'error', message: 'Qt not found' });

// BAD: inline locale check
message: locale === 'zh' ? '未找到 Qt' : 'Qt not found'

// GOOD: use T()
diagnostics.push({ code: 'toolchain.qtMissing', level: 'error', message: T('qtNotFound', locale) });
```

**Never use `locale === 'zh' ? ... : ...` inline** — always add a key to the `UI` table and use `T()`. This keeps all translations in one place and ensures consistency.

For messages with dynamic content (e.g. `Language set to: ${value}`), use a prefix key:
```typescript
message: `${T('langSetPrefix', locale)} ${value}`
```

## Adding a New Command

When adding a new CLI command:

1. Define the result interface extending `ForjaJsonResult`
2. Write a `formatXxxText(result: XxxResult, locale: Locale): string` function in the command file
3. Use `T(key, locale)` for all user-visible strings; add new keys to the `UI` table in `types.ts`
4. Export it and import in the dispatcher
5. Pass it to `outputResult()` in the handler with locale

### Text formatter pattern

```typescript
export function formatXxxText(result: XxxResult, locale: Locale): string {
    const lines: string[] = [];
    if (!result.ok) {
        lines.push(T('error', locale));
        if (result.diagnostics) {
            for (const d of result.diagnostics) lines.push(`  ${d.message}`);
        }
        if (result.nextActions?.length) {
            lines.push(T('next', locale));
            for (const a of result.nextActions) lines.push(`  ${a}`);
        }
        return lines.join('\n');
    }
    // Command-specific text output using T() for labels...
    return lines.join('\n');
}
```

## nextActions Consistency with --json Flag

The `nextActions` array in command results must be consistent with the `--json` flag:
- **With `--json`**: nextActions must include `--json` in each command (e.g., `"forja status --json"`)
- **Without `--json`**: nextActions must NOT include `--json` (e.g., `"forja status"`)

This ensures that when users copy-paste nextActions from JSON output, they get JSON output; when they copy from text output, they get text output.

### Implementation

Two helper functions in `src/cli/commands/index.ts`:

```typescript
export function stripJson(actions: string[] | undefined): string[] | undefined {
    if (!actions) { return actions; }
    return actions.map(a => a.replace(/\s*--json\b/g, ''));
}

export function ensureJson(actions: string[] | undefined): string[] | undefined {
    if (!actions) { return actions; }
    return actions.map(a => a.includes('--json') ? a : `${a} --json`);
}
```

A normalization function applies the right transformation:

```typescript
function normalizeNextActions(result: ForjaJsonResult, wantsJson: boolean): ForjaJsonResult {
    if (!result.nextActions) { return result; }
    if (wantsJson) {
        return { ...result, nextActions: ensureJson(result.nextActions) };
    }
    return { ...result, nextActions: stripJson(result.nextActions) };
}
```

### Where to Apply

**`outputResult()` in `index.ts`**:
```typescript
function outputResult(result: ForjaJsonResult, wantsJson: boolean, textFormatter?: (r: unknown) => string): void {
    result = normalizeNextActions(result, wantsJson);
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else if (textFormatter) {
        console.log(textFormatter(result));
    } else {
        // ... fallback
    }
}
```

**Custom output functions** (`outputBuildResult`, `outputRunResult`, `outputCleanResult`, `outputStopResult`):

These functions have their own output logic and must also normalize nextActions:

```typescript
export function outputBuildResult(result: BuildResult, wantsJson: boolean, locale: Locale, qtResult?: CliResult): void {
    if (wantsJson) {
        result = { ...result, nextActions: ensureJson(result.nextActions) };
    } else {
        result = { ...result, nextActions: stripJson(result.nextActions) };
    }
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else if (qtResult) {
        // Also strip --json from qtResult nextActions for text display
        const cleanedQtResult = { ...qtResult, nextActions: stripJson(qtResult.nextActions) as any };
        console.log(textOutput(cleanedQtResult));
    } else {
        // ... text output
    }
}
```

### Pattern for New Commands

When creating a new command with custom output logic:

1. Import `stripJson` and `ensureJson` from `./index`
2. At the start of your output function, normalize nextActions based on `wantsJson`:
   ```typescript
   if (wantsJson) {
       result = { ...result, nextActions: ensureJson(result.nextActions) };
   } else {
       result = { ...result, nextActions: stripJson(result.nextActions) };
   }
   ```
3. If you're wrapping another result (like `qtResult`), also strip its nextActions for text mode

### JSON-Text Field Parity

Every data field in the JSON result **must** have a corresponding display in the text formatter. Silent data loss between modes is a bug.

**Bug pattern**: A field like `buildOrder[].args` is included in the JSON result interface and populated by the data function, but the text formatter only shows `target:action` and silently drops `args`.

**Fix**: In the text formatter, explicitly render every field:
```typescript
for (const b of rem.buildOrder) {
    const args = b.args?.length ? ` ${b.args.join(' ')}` : '';
    lines.push(`    ${b.target}:${b.action}${args}`);
}
```

**Audit checklist**:
- [ ] For each field in the JSON result interface, verify the text formatter displays it
- [ ] Nested objects/arrays — check that sub-fields are not silently dropped
- [ ] Optional fields — verify the text formatter handles both present and absent cases
- [ ] Array items — check that all properties of each item are displayed, not just the first one

### Audit Checklist Addition

- [ ] Do nextActions include `--json` when the command was called with `--json`?
- [ ] Do nextActions exclude `--json` when the command was called without `--json`?
- [ ] Are custom output functions (not using `outputResult`) also normalizing nextActions?
- [ ] Are wrapped results (like `qtResult`) also having their nextActions normalized?

## Audit Checklist

- [ ] Does every command have a text formatter function?
- [ ] Does every formatter accept `locale: Locale` and use `T()` for user-visible strings?
- [ ] Do diagnostic `message:` and `hint:` fields in business logic use `T()` (not hardcoded English)?
- [ ] Are there zero `locale === 'zh' ? ... : ...` inline patterns? (All must go through T())
- [ ] Does `outputResult()` fallback produce text (not JSON) when no formatter is given?
- [ ] Are error paths in handlers covered? (generic fallback handles them, but specific formatters are better)
- [ ] Does `forja <command>` (no `--json`) produce readable text in the system locale?
- [ ] Does `forja <command> --json` produce valid JSON?
- [ ] Are new user-visible strings added to the `UI` table in `types.ts`?
- [ ] Does Windows locale detection work? (Intl.DateTimeFormat fallback)
