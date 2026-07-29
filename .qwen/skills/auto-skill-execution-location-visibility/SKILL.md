---
name: execution-location-visibility
description: CLI commands that can execute locally or remotely must show execution location as the first line of text output
source: auto-skill
extracted_at: '2026-07-02T07:08:12.795Z'
---

# Execution Location Visibility

When CLI commands can execute in different environments (e.g., local vs remote), users must never have to guess where the command ran. The execution location must be the **first line** of text output.

## Pattern

Every execution command's text output formatter must start with a location indicator:

```typescript
export function outputBuildResult(result: BuildResult, wantsJson: boolean): void {
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        // FIRST LINE: execution location
        if (result.activeTarget) {
            const t = result.activeTarget;
            if (t.runAt === 'remote' && result.workspace) {
                const remote = loadRemoteSettings(result.workspace);
                const server = remote.selectedServer ? getServerById(remote.selectedServer) : null;
                console.log(`→ remote:${server?.name || remote.selectedServer}`);
            } else {
                console.log('→ local');
            }
        }
        // THEN: status and details
        const status = result.ok ? T('buildSucceeded') : T('buildFailed');
        console.log(`${T('build')} ${status}`);
        // ...
    }
}
```

## Output format

```
$ forja build
→ local
Build succeeded
Target: qt · app.pro · debug/x64 · local

$ forja build
→ remote:my-server
Build succeeded
Target: qt · app.pro · debug/x64 · remote
```

## Rules

1. **Location is first** — before status, before target details
2. **Show server name for remote** — load from serverStore, fall back to server ID
3. **Always show for local too** — `→ local` makes it explicit, not just absence of `→ remote`
4. **JSON output unchanged** — location is already in `activeTarget.runAt`, no extra field needed
5. **All execution commands** — build, run, stop, clean must all show location; not just some

## Why

Users switch between local and remote via `activeTarget.runAt`. Without visible indication, they can forget which mode they're in — leading to confusion when builds take unexpectedly long (remote) or fail due to missing local toolchain. The first-line indicator eliminates this ambiguity at zero cognitive cost.

## Checklist

- [ ] Does every execution command (build/run/stop/clean) show `→ local` or `→ remote:<name>` as first output line?
- [ ] Is the server name resolved from serverStore (not just ID)?
- [ ] Is JSON output unaffected?
- [ ] Does `forja status` also show execution location prominently?
