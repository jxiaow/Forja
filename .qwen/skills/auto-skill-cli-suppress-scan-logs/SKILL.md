---
name: cli-suppress-scan-logs
description: CLI commands that call shared detection/scanning utilities must suppress internal log() output with setSilent(true) — users see final results, not scan progress
source: auto-skill
extracted_at: '2026-07-02T12:12:51.459Z'
---

# CLI Suppress Scan Logs

Shared utility functions (e.g. `detectEnv()`, `scanQt()`) use `log()` from `core/loggerBase.ts` to emit INFO-level diagnostic messages during execution (e.g. "扫描目录: ...", "注册表找到 Qt: ..."). These are useful in VSCode's OutputChannel but leak to stderr in CLI context, cluttering the user's terminal with process noise instead of showing clean final results.

## Rule

CLI command functions that invoke detection/scanning utilities must call `setSilent(true)` before the call. ERROR-level logs are never suppressed.

```typescript
import { setSilent } from '../../core/loggerBase';

async function listEnvAll(workspace: string): Promise<ListResult> {
    setSilent(true);  // suppress INFO/WARN from detectEnv internals
    const env = await detectEnv();
    // ... build clean result from env data
}
```

## Why

`log()` writes to `process.stderr` in CLI context. Terminals display stderr alongside stdout, so users see raw scan progress lines mixed with the formatted output. The user expects a clean summary (configured/available items), not internal diagnostic traces.

## How `setSilent` works

- `setSilent(true)` suppresses INFO and WARN levels; ERROR always passes through
- Module-level flag in `core/loggerBase.ts` — affects all subsequent `log()`/`warn()` calls
- VSCode extension is unaffected (uses `setOutputWriter` to bridge to OutputChannel)
- `--json` mode already sets silent via the existing `setSilent(wantsJson)` call in the dispatcher

## When to apply

Any CLI command function that calls shared detection/scanning utilities which internally use `log()`:
- `listEnvAll()`, `listEnvQt()`, `listEnvJom()` → call `detectEnv()`
- Future commands that call `scanQt()`, `scanVS()`, `detectJom()`, etc.

## Audit checklist

- [ ] Does the CLI function call `setSilent(true)` before invoking detection utilities?
- [ ] Are ERROR-level messages still visible (they should be — `setSilent` only suppresses INFO/WARN)?
- [ ] Is the final output a clean summary, not raw scan traces?
