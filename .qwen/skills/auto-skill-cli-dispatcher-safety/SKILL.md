---
name: cli-dispatcher-safety
description: Centralized CLI dispatcher must intercept --help before handlers, output JSON errors when --json, and validate global flag values
source: auto-skill
extracted_at: '2026-06-24T02:32:32.183Z'
---

# CLI Dispatcher Safety

The CLI dispatcher (`runCli()`) is the single entry point for all commands. It must enforce safety invariants **before** dispatching to individual handlers. Per-handler flag validation (see `cli-unknown-flag-validation`) is not enough — the dispatcher itself must handle global edge cases.

## 1. Intercept --help before ANY other check (including no-command)

`--help` and `-h` are in `GLOBAL_FLAGS`, so per-handler `findUnknownFlags()` lets them through. If no one intercepts them, they reach the handler and the command **executes normally** — `forja build --help` triggers a real build.

**Critical ordering:** The `--help` intercept must come **before** the "no command" check. Otherwise `forja --help` (where `argv[0]` is `--help`) hits the `argv[0].startsWith('--')` guard and errors with "No command specified" instead of showing help.

```typescript
// Correct order in runCli():
// 1. Check workspaceError
// 2. Intercept --help / -h  ← BEFORE no-command check
// 3. Check no-command
// 4. Dispatch to handler

if (argv.includes('--help') || argv.includes('-h')) {
    const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
    const helpText = cmd ? (COMMAND_HELP[cmd] || `Unknown command: ${cmd}`) : TOP_LEVEL_HELP;
    if (wantsJson) {
        outputResult({ ok: true, action: cmd || 'help', diagnostics: [{ code: 'cli.help', level: 'info', message: helpText }] }, wantsJson);
    } else {
        console.log(helpText);
    }
    return;  // do NOT dispatch to handler
}
```

Maintain a `COMMAND_HELP` map with one-line usage per command, and a `TOP_LEVEL_HELP` string for `forja --help` with no command.

## 2. Unknown commands must respect --json

The `default` case in the command switch must check `wantsJson` — otherwise `forja frobnicate --json` outputs plain text to stderr, breaking automation:

```typescript
default:
    if (wantsJson) {
        outputResult({ ok: false, action: command, diagnostics: [{ code: 'cli.unknownCommand', level: 'error', message: `Unknown command: ${command}` }] }, wantsJson);
    } else {
        console.error(`Unknown command: ${command}`);
    }
    process.exitCode = 1;
```

Same pattern for the "no command" check at the top of `runCli()`.

## 3. --workspace missing value must error, not fall back to cwd

`extractWorkspace()` must detect when `--workspace` is present but the next token is missing or starts with `--`. Silently falling back to `process.cwd()` causes `forja build --workspace --json` to build the **current** directory — potentially destructive.

```typescript
let workspaceError: string | null = null;

function extractWorkspace(argv: string[]): string {
    const idx = argv.indexOf('--workspace');
    if (idx >= 0) {
        const next = argv[idx + 1];
        if (!next || next.startsWith('--')) {
            workspaceError = '--workspace requires a value';
            return process.cwd();
        }
        return path.resolve(next);
    }
    return process.cwd();
}
```

Then in `runCli()`, check `workspaceError` **before** any command dispatch and return an error.

## 4. Plan/dry-run must match execution

When a command has a `--plan` mode, the plan output must exactly reflect what real execution would do. If execution skips an operation under certain conditions (e.g., no targets → skip bridge), the plan must show the same empty result — not a default/fallback.

**Anti-pattern:**
```typescript
// Plan branch:
if (kinds.length === 0) { kinds.push('qt'); }  // defaults to qt
// Execution branch:
if (kinds.length === 0) { skip(); }             // skips
// Plan and execution disagree → scripts get wrong preview
```

## 5. extractFlag must not be called twice for the same flag

`extractFlag()` removes the flag+value from argv on first call. A second call for the same flag returns `undefined`. This causes silent data loss:

```typescript
// BUG: first extractFlag removes --port from argv, second call returns undefined
port: extractFlag(argv, '--port') ? parseInt(extractFlag(argv, '--port')!, 10) : undefined,
// Result: port is always NaN
```

**Correct pattern:** Extract once into a variable, then validate:

```typescript
const portStr = extractFlag(argv, '--port');
let port: number | undefined;
if (portStr) {
    port = parseInt(portStr, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
        // error: invalid port
    }
}
```

## 6. parseInt from CLI input must always have NaN/range validation

Every `parseInt` on user input must check for `NaN` and valid range. Without validation, `forja setup --port abc` writes `NaN` to config, causing SSH failures later.

**Pattern:** Reuse the project's standard validation:
```typescript
if (isNaN(port) || port < 1 || port > 65535) {
    // error with T('idx.invalidPort') + T('idx.invalidPortHint')
}
```

## Checklist

- [ ] Does the dispatcher intercept `--help`/`-h` **before** the no-command check?
- [ ] Does `forja --help` (no command) show top-level help, not error?
- [ ] Does the `default` (unknown command) case output JSON when `--json` is set?
- [ ] Does `extractWorkspace()` reject `--workspace` followed by another flag?
- [ ] Does the "no command" error output JSON when `--json` is set?
- [ ] Does `--plan` output match what execution would actually do under the same conditions?
- [ ] Does `valueFlag` detection reject when next token starts with `--` (missing value)?
- [ ] Is `extractFlag()` called exactly once per flag? (no double-call in ternaries)
- [ ] Does every `parseInt` on CLI input have `isNaN` + range validation?
