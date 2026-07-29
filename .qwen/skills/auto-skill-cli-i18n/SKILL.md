---
name: cli-i18n
description: All CLI text output must be locale-aware via T() translation table with global locale — no hardcoded English, no locale parameter passing
source: auto-skill
extracted_at: '2026-06-26T08:06:34.913Z'
---

# CLI i18n — Global Locale Pattern

All user-visible CLI text must support Chinese/English via a centralized translation table. T() automatically uses the global locale — no need to pass locale parameter.

## Locale Resolution Priority

`resolveLocale()` in `src/cli/commands/types.ts` determines the active locale:

1. `--lang <zh|en>` flag (highest)
2. Global config (`~/.forja/config.json` → `lang` field)
3. `FORJA_LANG` environment variable
4. `Intl.DateTimeFormat().resolvedOptions().locale` (cross-platform system detection)
5. Default: `'en'`

**Key lesson**: On Windows, `LC_ALL`/`LANG` env vars are typically unset. Must use `Intl.DateTimeFormat()` API for system locale detection — not just env vars.

## Global Locale Pattern

The CLI entry point sets the global locale once, then all T() calls use it automatically:

```typescript
// In runCli() — src/cli/commands/index.ts
const locale = resolveLocale(extractFlag(argv, '--lang'), globalConfig.lang);
setGlobalLocale(locale);

// All subsequent T() calls use this locale automatically
console.log(T('workspace'));  // No locale parameter needed!
```

**Implementation in types.ts**:

```typescript
// Global locale state
let _globalLocale: Locale = 'en';

export function setGlobalLocale(locale: Locale): void {
    _globalLocale = locale;
}

export function getGlobalLocale(): Locale {
    return _globalLocale;
}

// Translation function — uses global locale automatically
// Supports positional params: T('key', ['val0', 'val1']) replaces {0}, {1} in the text
export function T(key: string, params?: string[]): string {
    const entry = UI[key];
    let text = entry ? entry[_globalLocale] : key;  // fallback: return key itself
    if (params) {
        for (let i = 0; i < params.length; i++) {
            text = text.replace(`{${i}}`, params[i]);
        }
    }
    return text;
}
```

## Translation Table

`types.ts` contains a `UI` dictionary with 300+ translation keys:

```typescript
const UI: Record<string, { en: string; zh: string }> = {
    error:     { en: 'Error',     zh: '错误' },
    next:      { en: 'Next:',     zh: '后续：' },
    workspace: { en: 'Workspace:', zh: '工作区：' },
    // ... 300+ keys
};
```

## Setting Language

- **Set**: `forja use lang zh` / `forja use lang en`
- **View**: `forja list lang` (shows current effective language)
- **Storage**: `~/.forja/config.json` via `loadGlobalConfig()` / `saveGlobalConfig()`

## Rules

1. **Use T('key') without locale parameter** — global locale is set automatically
2. **No inline `locale === 'zh' ?` ternaries** — always use T(key)
3. **Diagnostics messages use T()** — business logic functions create diagnostics with T() calls
4. **Help text uses T()** — `forja server` help, `forja use` help, etc.
5. **`--lang` is a GLOBAL_FLAG** — already in the global flags set, no per-command registration needed
6. **New user-visible string → add to UI table** — both `en` and `zh` entries required
7. **Interactive prompts use T()** — `prompt()`, `confirm()`, `choose()` all use T() for messages
8. **Dynamic values use T() params** — `T('key', ['val0', 'val1'])` replaces `{0}`, `{1}` in text. Never use manual `.replace('{0}', ...)` — always go through T() params

## VSCode Commands Must Also Set Global Locale

VSCode command handlers (in `src/vscode/commands.ts`) must also resolve and set locale:

```typescript
const locale = resolveLocale(undefined, loadGlobalConfig().lang);
setGlobalLocale(locale);
```

Without `loadGlobalConfig().lang`, VSCode output ignores the user's `forja use lang` setting.

## Common Pitfalls

- **Windows locale detection**: `LC_ALL`/`LANG` are empty on Windows. Must use `Intl.DateTimeFormat().resolvedOptions().locale`.
- **VSCode commands skipping stored lang**: `resolveLocale()` without second arg ignores `forja use lang` setting.
- **Error paths missing locale**: When `outputResult` is called without a formatter (error paths), the fallback text uses T() which automatically uses global locale.
- **`enabled=` in translations**: Don't include `=` in translation values — it's a separator, not part of the label.
- **Output functions use T()**: `outputBuildResult`, `outputRunResult`, `outputCleanResult`, `outputStopResult` all use T() without locale parameter.
- **VSCode QuickPick descriptions**: When showing a QuickPick with category descriptions, use locale to pick the right language — don't hardcode Chinese or English. Pattern: `description: locale === 'zh' ? descMap[c]?.[1] : descMap[c]?.[0]`.
- **Diagnostic messages in business logic**: Functions like `assessTargetReadiness`, `assessToolchainReadiness` create Diagnostic objects with `message:` strings using T() calls.
- **Don't pass locale to T()** — this is the key improvement. The old pattern `T('key', locale)` is wrong. Use `T('key')` only.
- **Core functions returning hardcoded messages**: Core/shared functions (in `sync/cli.ts`, `core/`, etc.) cannot use T() — they're shared between CLI and VSCode. When they return diagnostics or status info, they must return **structured data with stable codes** (e.g., `missing: string[]`), NOT localized messages. The **command layer** (`runSync`, `runStatus`, etc.) then maps those codes to T() calls when constructing Diagnostic objects. The formatter layer just outputs `d.message` as-is. Example: `statusSyncCli` returns `missing: ['enabled', 'servers']`, and `runSync`'s status case builds the result, while `formatSyncText` maps each missing code to `T('syncMissingEnabled')`, `T('syncMissingServers')`, etc. Never pass core function's hardcoded messages directly to output — they won't adapt to locale.
- **Module-level const trap**: `const HELP = T('help.text')` does NOT work — T() is called at module load time before `setGlobalLocale()` runs. Must use a **function** that calls T() at runtime: `function getHelp(): string { return T('help.text'); }`. This applies to any module-level string that uses T() — help texts, error messages, default values, etc.

## Text Output Formatting Rules

All text formatters (`formatStatusText`, `formatSetupText`, `formatDoctorText`, `outputBuildResult`, etc.) follow a unified format:

### Label Convention

T() keys that are labels **contain the localized colon** in their value:

```typescript
// In UI table:
workspace: { en: 'Workspace:', zh: '工作区：' }  // colon baked in

// In formatter code — NO extra colon or space:
`${T('workspace')}${result.workspace}`  // → "Workspace:C:\repo" or "工作区：C:\repo"
```

**Never** add `: ` after a T() label — this causes double-colon bugs like `"Workspace:: C:\repo"` or `"工作区：: C:\repo"`.

### Readiness Format

Readiness items use `=` between key and state, double-space between items:

```
就绪度：目标=就绪  工具链=已配置  同步=已配置  远程=未选择
```

### Target Format

Target info on one line with `·` separators:

```
目标：qt · release/x86 · local
项目：qt_linux_pc_client\qt_linux_pc_client.pro
```

### Common Pitfalls

- **Double-colon bug**: `${T('doctor')}: ${action}` produces `"Doctor:: check"` because T('doctor') already contains `:`. Fix: `${T('doctor')}${action}`.
- **Hardcoded labels**: Never use `Qt:`, `VS:`, `SDK:` etc. directly. Always use T() keys (`T('qtLabel')`, `T('vsLabel')`, `T('sdkLabel')`).
- **Inline locale checks**: Never use `locale === 'zh' ? '本地:' : 'Local:'`. Always add a T() key and use `T('setupLocal')`.
- **Manual alignment padding**: Don't use `T('label')     ${value}` for alignment. Just use `${T('label')}${value}`.

## T() Key Validation — Critical Audit

**T() returns the raw key string when the key is not found in the translation table.** This means a typo or stale key silently shows raw camelCase identifiers to users (e.g., `use.invalidModeHint` instead of "Must be debug or release").

### Audit Procedure

After adding or modifying T() calls in any file:

1. **Extract all T() keys** from the changed file(s): grep for `T('...')` patterns
2. **Cross-reference against the UI table** in `types.ts` — every key used in code MUST exist in the `UI` dictionary
3. **Check for renamed/deleted keys** — if a key was renamed in the UI table, all call sites must be updated
4. **Watch for near-miss naming** — code may use `use.invalidModeHint` while the table has `use.invalidModeDetail` (different suffix for the same concept)

### Known Pitfall Pattern

The most common mismatch is when code and table use **different naming conventions** for the same concept:
- Code: `use.invalidModeHint` → Table: `use.invalidModeDetail`
- Code: `idx.unexpectedArg` → Table: `idx.unexpectedArgument`
- Code: `init.remoteInitOk` → Table: `init.remoteInitSucceeded`

**Rule**: The translation table is authoritative. Code must use the exact key names from the table. When in doubt, search the table first, then use the existing key.

### Quick Check Command

```bash
# Extract all T() keys from source, then diff against UI table keys in types.ts
grep -oP "T\('[^']+'\)" src/cli/commands/*.ts | sort -u
```

## Migration Checklist

When adding new translatable strings:

1. Add key to `UI` table in `types.ts` with both `en` and `zh` values
2. Use `T('key')` in the code (no locale parameter)
3. **Verify the key exists in the UI table** — T() silently returns the raw key if not found
4. Test with `--lang en` and `--lang zh` to verify both translations work

## Benefits of Global Locale Pattern

- **Simpler API**: `T('key')` instead of `T('key', locale)`
- **Less error-prone**: No need to pass locale through every function
- **Consistent**: All T() calls use the same locale
- **Easier to maintain**: One place to set locale (CLI entry point)
