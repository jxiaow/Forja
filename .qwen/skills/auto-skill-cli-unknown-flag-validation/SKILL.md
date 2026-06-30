---
name: cli-unknown-flag-validation
description: All CLI command handlers must validate unknown flags — typos in --flags must error, not silently pass
source: auto-skill
extracted_at: '2026-06-23T20:45:00.000Z'
---

# CLI Unknown Flag Validation

Every top-level CLI command handler must validate its flags against a known set. Unknown `--flag` values (typos, removed flags, wrong command) must produce an error — not be silently ignored.

## The Pattern

Use `findUnknownFlags()` at the top of each handler, before any logic:

```typescript
function handleStatus(argv: string[], workspace: string, wantsJson: boolean): void {
    const unknown = findUnknownFlags(argv,
        new Set(['--process', '--lang']),    // known flags
        new Set(['--lang'])                   // flags that take a value
    );
    if (unknown.length > 0) {
        outputResult({
            ok: false, action: 'status',
            diagnostics: [{ level: 'error',
                message: `Unknown flag(s): ${unknown.join(', ')}` }],
            nextActions: ['forja status'],
        }, wantsJson);
        process.exitCode = 1;
        return;
    }
    // ... normal handler logic
}
```

## Key details

1. **GLOBAL_FLAGS are auto-excluded**: `--json`, `--workspace`, `--lang`, `--help`, `-h` are always allowed
2. **Flags with values need declaration**: If `--server <id>` takes a value, add it to `flagsWithValues` so the next arg isn't misidentified as an unknown flag
3. **Complex commands (use, server)**: Collect ALL known flags across all subcommands into one set. Per-subcommand validation is too fragile
4. **Error code pattern**: `<command>.unknownFlag`
5. **nextActions**: Point to the command without flags (e.g., `forja status`, not `forja status --help`)

## Critical: read the ENTIRE handler body

When building the known-flags set, you MUST read the entire handler function body — not just the first few lines. Flags used deep in the handler (e.g., `--detach`, `--debug`, `--custom`, `--plan` in the `run` handler; `--repo` in the `sync` handler) are easy to miss. If a flag is read anywhere in the handler via `hasFlag()`, `extractFlag()`, or `extractAllFlags()`, it MUST be in the known set.

## Critical: value flags must be in BOTH sets

A flag used with `extractFlag(argv, '--foo')` to read a string value MUST be in **both** the known-flags set **and** the value-flags set. If it's only in the known set (treated as boolean), `findUnknownFlags()` won't consume the next token, causing the value to leak as a positional argument.

**Bug example:** `--local` and `--remote` were in `useKnown` but not `useWithVal`. The handler called `extractFlag(argv, '--local')` to read a repo name, but the validator treated them as boolean flags. The value (`myrepo`) became an unvalidated positional arg.

**Rule:** When adding a flag that takes a value, add it to BOTH `useKnown` AND `useWithVal`. When auditing, check every `extractFlag()` call and verify the flag is in the value set.

## Critical: value flag missing value

`findUnknownFlags()` must check that a value flag's next token exists and doesn't start with `--`. Otherwise `forja init --server --bad --json` silently swallows `--bad` as the value of `--server`:

```typescript
if (flagsWithValues.has(arg)) {
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
        unknown.push(`${arg}=<missing>`);  // report missing value
    } else {
        i++;  // skip the value
    }
}
```

Similarly, `extractWorkspace()` must check `!argv[idx + 1].startsWith('--')` to prevent `--workspace --json` from parsing `--json` as a path.

## Commands that need this

Every handler in the CLI dispatcher:
- `status`: --process, --lang
- `init`: --plan, --remote, --server
- `list`: --detail
- `use`: (all subcommand flags combined)
- `server`: (all subcommand flags combined)
- `build`: --plan
- `run`: --file, --detach, --debug, --custom, --plan
- `stop`: (none)
- `clean`: --plan
- `doctor`: --fix, --unlock, --restore, --reset, --clean-untracked, --remote, --server, --force, --recursive
- `sync`: --plan, --file, --server, --force, --repo

## Why this matters

Without validation, `forja status --proces` (typo) runs normal status and the user never notices the flag was ignored. In scripts, this causes silent misconfiguration.
