---
name: cli-vscode-decouple
description: Decouple CLI functions from I/O side effects so they can be consumed by both CLI entry and VSCode commands
source: auto-skill
extracted_at: '2026-06-17T11:30:57.441Z'
---

# CLI/VSCode Decoupling Pattern

## Problem

CLI functions (e.g., `runBuild`, `runRun`, `runClean`) were writing directly to `process.exitCode` and `console.log`. When VSCode commands called these functions, it polluted the extension host runtime:
- Multiple commands sharing global `process.exitCode`
- Output going to extension host console instead of VSCode user-visible channels

## Solution

Separate pure logic (returns result) from I/O layer (handles output/exitCode).

### Pattern

1. **CLI function returns result object**
   ```typescript
   export async function runBuild(workspace: string, action: BuildAction, options: {...}): Promise<BuildResult> {
     // Pure logic: validate, execute, return result
     return { ok: boolean, diagnostics: [...], ... };
   }
   ```

2. **Export output function for CLI entry**
   ```typescript
   export function outputBuildResult(result: BuildResult, wantsJson: boolean, qtResult?: CliResult): void {
     if (wantsJson) {
       console.log(JSON.stringify(result, null, 2));
     } else {
       // Text formatting
     }
   }
   ```

3. **CLI entry calls output + sets exitCode**
   ```typescript
   async function handleBuild(argv: string[], workspace: string, wantsJson: boolean): Promise<void> {
     const result = await runBuild(workspace, buildAction, { plan: ..., json: wantsJson });
     outputBuildResult(result, wantsJson);
     if (!result.ok) { process.exitCode = 1; }
   }
   ```

4. **VSCode commands consume result directly**
   ```typescript
   vscode.commands.registerCommand('forja.build', async () => {
     const result = await runBuild(workspace(), buildAction, { json: true });
     if (result.ok) {
       vscode.window.showInformationMessage('Build succeeded');
     } else {
       const msg = result.diagnostics?.[0]?.message || 'Build failed';
       vscode.window.showErrorMessage(msg);
     }
   });
   ```

## Key Points

- CLI functions must NOT write to `process.exitCode` or `console.log`
- Export `output*Result` functions for CLI entry to handle formatting
- VSCode commands check `result.ok` and use `vscode.window.show*Message`
- When spawning child processes in CLI context:
  - Use `stdio: ['inherit', 'pipe', 'pipe']` to capture output
  - Only forward to terminal when NOT in JSON mode
  - Resolve relative paths against workspace before passing to `cwd`

## Example Files

- `src/cli/commands/build.ts` - `runBuild` returns `BuildResult`, exports `outputBuildResult`
- `src/cli/commands/run.ts` - `runRun` returns `RunResult`, exports `outputRunResult`
- `src/cli/commands/clean.ts` - `runClean` returns `CleanResult`, exports `outputCleanResult`
- `src/cli/commands/index.ts` - CLI entry calls output functions + sets exitCode
- `src/vscode/commands.ts` - VSCode commands consume result objects

## Gotchas

### Converting void → result return type
When a function currently returns `void` and handles output internally (common in older commands), refactor to return a result object:

1. Change return type from `Promise<void>` to `Promise<ResultType>`
2. Remove all `outputResult()` and `process.exitCode` calls from the function body
3. Export the `output*Result()` function if not already exported
4. Move output + exitCode handling to the CLI dispatcher (index.ts)
5. VSCode command calls the same function and maps result to `vscode.window.show*Message`

```typescript
// Before: function handles its own output
export async function runStop(workspace: string): Promise<void> {
  const result: StopResult = { ... };
  outputStopResult(result, wantsJson, locale);
  process.exitCode = result.ok ? 0 : 1;
}

// After: function returns result, caller handles output
export async function runStop(workspace: string): Promise<StopResult> {
  return { ok: true, state: 'stopped', ... };
}
// CLI dispatcher:
const result = await runStop(workspace, { json: wantsJson });
outputStopResult(result, wantsJson);
if (!result.ok) { process.exitCode = 1; }
// VSCode command:
const result = await runStop(workspace());
if (result.state === 'stopped') { vscode.window.showInformationMessage('...'); }
```

### Don't leave dead parameters
After moving output to the caller, parameters that were only used for output (like `locale` passed to `T()`) become dead. Remove them from the function signature. The global locale mechanism (used by `T()`) makes per-call locale parameters unnecessary.

### Async spawn errors
When using `cp.spawn`, the `error` event is async. Don't return `ok: true` immediately after spawn. Use Promise to wait for `spawn` or `error` event:

```typescript
return new Promise((resolve) => {
  const proc = cp.spawn(exe, args, { detached: true, stdio: 'ignore' });
  let settled = false;

  proc.once('spawn', () => {
    if (!settled) {
      settled = true;
      proc.unref();
      resolve({ ok: true, ... });
    }
  });

  proc.once('error', (err) => {
    if (!settled) {
      settled = true;
      resolve({ ok: false, error: err.message });
    }
  });
});
```

### Pre-spawn existence check
Before spawning, verify executable exists (except for PATH fallback like `'designer'`):

```typescript
if (exe !== 'designer' && !fs.existsSync(exe)) {
  return { ok: false, error: `Not found: ${exe}` };
}
```

### Relative path resolution
When passing `cwd` to child processes, resolve relative paths against workspace:

```typescript
const projectDir = path.isAbsolute(target.project)
  ? path.dirname(target.project)
  : path.join(workspace, path.dirname(target.project));

cp.spawnSync(cmd, { cwd: projectDir, ... });
```

### JSON output safety
When CLI function may output JSON, don't use `stdio: 'inherit'` for child processes. Capture output and only forward when not in JSON mode:

```typescript
const result = cp.spawnSync(cmd, { stdio: ['inherit', 'pipe', 'pipe'] });
const stdout = result.stdout?.toString() ?? '';

if (!options.json) {
  process.stdout.write(stdout);
}
```
