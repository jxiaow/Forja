---
name: cli-deep-testing
description: Write CLI integration tests with real depth — verify output correctness, state transitions, cross-command consistency, and catch actual bugs instead of just smoke testing
source: auto-skill
extracted_at: '2026-06-26T12:00:00.000Z'
---

# CLI Deep Testing

When writing tests for CLI commands, avoid shallow "smoke tests" that only verify commands don't crash. Write tests that catch real bugs by verifying output correctness, state transitions, and cross-command consistency.

## Smoke Tests vs Deep Tests

**Smoke test (useless):**
```typescript
test('status returns JSON', () => {
    const result = runForja('status --json');
    const json = parseJson(result.stdout);
    assert.ok(json);                  // ← just checks it's valid JSON
    assert.equal(json.action, 'status'); // ← checks one field
});
```

**Deep test (catches bugs):**
```typescript
test('status JSON readiness matches text output', () => {
    const jsonResult = runForja('status --json');
    const textResult = runForja('status --lang zh');
    const json = parseJson(jsonResult.stdout);

    // Verify readiness values appear in text output
    for (const [key, state] of Object.entries(json.readiness)) {
        const translatedKey = readinessKeyMap[key];
        const translatedState = readinessStateMap[state];
        assert.ok(
            textResult.stdout.includes(`${translatedKey}=${translatedState}`),
            `Readiness ${key}=${state} should appear in text as ${translatedKey}=${translatedState}`
        );
    }
});
```

## What to Test (Depth Checklist)

### 1. Output Format Consistency

Don't just check "contains string". Verify exact format patterns:

```typescript
// Every label uses localized colon (no space between colon and value)
assert.match(text, /工作区：\S/);    // value immediately after colon
assert.notMatch(text, /工作区： /);  // no space after colon

// Readiness uses = separator, not : or other
assert.match(text, /目标=就绪/);
assert.notMatch(text, /目标:就绪/);

// Toolchain paths are shortened (basename only, not full path)
assert.notMatch(text, /C:\\QtCompile\\/);  // no full Windows paths
```

### 2. State Transition Correctness

Verify commands actually change state, and the change is visible to other commands:

```typescript
test('server add → list servers shows new server', () => {
    runForja('server add --name test-srv --host 1.2.3.4 --username user --json');

    const list = parseJson(runForja('list servers --json').stdout);
    const found = list.servers.find(s => s.name === 'test-srv');
    assert.ok(found, 'New server should appear in list');
    assert.equal(found.host, '1.2.3.4');
    assert.equal(found.username, 'user');
});

test('use lang zh → status outputs Chinese', () => {
    runForja('use lang zh --json');
    const status = runForja('status');
    assert.match(status.stdout, /工作区：/);
    assert.notMatch(status.stdout, /Workspace:/);
});

test('server remove → list servers no longer shows it', () => {
    // Add, verify present, remove, verify absent
    runForja('server add --name temp-srv --host 1.1.1.1 --username u --json');
    let list = parseJson(runForja('list servers --json').stdout);
    assert.ok(list.servers.some(s => s.name === 'temp-srv'));

    const id = list.servers.find(s => s.name === 'temp-srv').id;
    runForja(`server remove ${id} --json`);
    list = parseJson(runForja('list servers --json').stdout);
    assert.ok(!list.servers.some(s => s.name === 'temp-srv'));
});
```

### 3. Cross-Command Data Consistency

Verify the same data appears consistently across different commands:

```typescript
test('status activeTarget matches list targets current flag', () => {
    const status = parseJson(runForja('status --json').stdout);
    const targets = parseJson(runForja('list targets --json').stdout);

    if (status.activeTarget) {
        const currentTarget = targets.targets.find(t => t.current);
        assert.ok(currentTarget, 'Some target should be marked current');
        // Normalize path separators for comparison
        const statusProject = status.activeTarget.project.replace(/\\/g, '/');
        const listProject = currentTarget.project.replace(/\\/g, '/');
        assert.equal(listProject, statusProject,
            'status activeTarget.project should match list targets current project');
    }
});

test('status sync server matches list servers selected flag', () => {
    const status = parseJson(runForja('status --json').stdout);
    const servers = parseJson(runForja('list servers --json').stdout);

    if (status.sync?.server) {
        const selectedServer = servers.servers.find(s => s.selected);
        assert.ok(selectedServer, 'Sync server should be marked selected in list');
        assert.equal(selectedServer.id, status.sync.server.id);
    }
});
```

### 4. NextActions Scenario Coverage

Test nextActions under different states — this is where UX bugs hide:

```typescript
test('nextActions with 0 servers shows add command', () => {
    // Remove all servers first
    const list = parseJson(runForja('list servers --json').stdout);
    for (const s of list.servers) {
        runForja(`server remove ${s.id} --json`);
    }

    const status = parseJson(runForja('status --json').stdout);
    assert.ok(status.nextActions.some(a => a.includes('server add')));
});

test('nextActions with 1 server auto-fills name', () => {
    // Setup: exactly 1 server
    const status = parseJson(runForja('status --json').stdout);
    const remoteActions = status.nextActions.filter(a => a.includes('use remote'));
    for (const action of remoteActions) {
        // Should contain actual server name, not <name> placeholder
        assert.match(action, /--server \w+/);
        assert.notMatch(action, /<name>/);
    }
});

test('nextActions with 2-5 servers shows pipe-separated names', () => {
    const status = parseJson(runForja('status --json').stdout);
    const remoteActions = status.nextActions.filter(a => a.includes('use remote'));
    for (const action of remoteActions) {
        // Should show <name1|name2|...> format
        assert.match(action, /<[^>]+\|[^>]+>/);
    }
});

test('nextActions do not contain stale command names', () => {
    const status = parseJson(runForja('status --json').stdout);
    for (const action of status.nextActions || []) {
        assert.notMatch(action, /forja init/);   // old command name
        assert.notMatch(action, /forja qt /);    // old subcommand
        assert.notMatch(action, /forja sdk /);   // old subcommand
    }
});
```

### 5. Bilingual Output Verification

Test both locales produce correct, complete output:

```typescript
test('status output is complete in both locales', () => {
    const zh = runForja('status --lang zh').stdout;
    const en = runForja('status --lang en').stdout;

    // Both should have the same number of lines (same structure)
    const zhLines = zh.trim().split('\n').filter(l => l.trim());
    const enLines = en.trim().split('\n').filter(l => l.trim());
    assert.equal(zhLines.length, enLines.length,
        'zh and en output should have same number of lines');

    // Both should have readiness with = format
    assert.match(zh, /=就绪|=已配置|=未选择/);
    assert.match(en, /=Ready|=Configured|=Not selected/);
});
```

### 6. Error Path Verification

Don't just check "exits non-zero". Verify error output is helpful:

```typescript
test('build without target gives actionable error', () => {
    const result = runForja('build --json');
    const json = parseJson(result.stdout);
    assert.equal(json.ok, false);
    assert.ok(json.diagnostics.length > 0);
    assert.ok(json.nextActions?.length > 0, 'Error should suggest next actions');
    // nextActions should be reachable commands
    for (const action of json.nextActions) {
        assert.match(action, /^forja /);
    }
});
```

## Test Infrastructure Pattern

```typescript
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Isolated test environment
const _testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-test-'));
process.env.FORJA_CONFIG_DIR = _testConfigDir;

function runForja(args: string, cwd?: string) {
    try {
        const stdout = execSync(`forja ${args}`, {
            cwd: cwd || _testWorkspace,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 10000,
        });
        return { stdout, stderr: '', exitCode: 0 };
    } catch (e: any) {
        return { stdout: e.stdout || '', stderr: e.stderr || '', exitCode: e.status || 1 };
    }
}

function parseJson(output: string): any {
    try { return JSON.parse(output.trim()); }
    catch { return null; }
}
```

## Key Principles

- **Test behavior, not just structure**: Don't just check "has field X" — check "field X has the correct value"
- **Test across commands**: Bugs often appear at the intersection of commands (status shows wrong data because list wrote it wrong)
- **Test state transitions**: The important thing is not that `server add` succeeds, but that `list servers` shows the new server afterward
- **Normalize paths**: Windows uses `\`, POSIX uses `/`. Always normalize before comparing: `.replace(/\\/g, '/')`
- **Test the user experience**: nextActions should be copy-pasteable commands, not abstract placeholders
- **Run tests in isolation**: Use `FORJA_CONFIG_DIR` to avoid polluting real config

## Manual Testing Workflow

**Before writing automated tests, manually run commands and observe behavior.** Automated tests that only check "command didn't crash" give false confidence.

### Step 1: Run Real Workflows

Execute actual user workflows and carefully observe each output:

```bash
# Basic status check
forja status
forja status --json

# List all categories
forja list targets
forja list servers
forja list env
forja list config
forja list lang

# Test state changes
forja server add --name test --host 1.2.3.4 --username user
forja list servers  # Does it show the new server?
forja use lang zh
forja status        # Is output now in Chinese?

# Test --plan flags (should NOT execute)
forja build --plan
forja clean --plan
forja run --plan
```

### Step 2: Observe and Record Issues

While running commands, actively look for:

**Format Issues:**
- Inconsistent separators (mixing `:`, `：`, `=`, `→`)
- Missing spaces after colons (`Workspace:C:\...` vs `Workspace: C:\...`)
- English text in Chinese locale (or vice versa)
- Diagnostic messages with no separator between level and message (`InfoRemote:` instead of `Info: Remote`)

**Logic Issues:**
- `--plan` flags that actually execute operations
- `current` flags that don't match actual state
- Path separator mismatches between commands (`\` vs `/`)
- nextActions showing stale command names or placeholders when actual values are available

**Data Consistency Issues:**
- `status activeTarget.project` doesn't match `list targets` current item
- `status sync.server` doesn't match `list servers` selected server
- State changes from one command not visible to other commands

### Step 3: Common Bug Patterns

Based on real bugs found in Forja CLI:

| Bug Pattern | Example | Root Cause |
|-------------|---------|------------|
| Path separator mismatch | status uses `\`, list uses `/` | Different code paths normalize differently |
| Locale not followed | Output in English when locale is zh | Text formatter doesn't use T() for all strings |
| --plan executes | `clean --plan` shows "succeeded" | Plan check missing or in wrong place |
| Double colon | `Doctor:check` | T() key has `：`, code adds another `:` |
| Missing plan field | `build --plan` JSON has no `plan` field | Plan path returns early without populating plan |
| current flag always false | `list targets` never marks current | Path comparison fails due to separator mismatch |
| Diagnostic concatenation | `InfoRemote:` instead of `Info: Remote` | Missing separator in diagnostic formatter |

### Step 4: Write Tests That Catch These Bugs

After manual testing reveals bugs, write automated tests that would have caught them:

```typescript
// Test for path separator consistency
test('status and list use consistent path separators', () => {
    const status = parseJson(runForja('status --json').stdout);
    const targets = parseJson(runForja('list targets --json').stdout);

    if (status.activeTarget) {
        const statusPath = status.activeTarget.project.replace(/\\/g, '/');
        const currentTarget = targets.targets.find(t => t.current);
        const listPath = currentTarget?.project.replace(/\\/g, '/');
        assert.equal(listPath, statusPath);
    }
});

// Test that --plan doesn't execute
test('clean --plan returns plan, not execution result', () => {
    const result = parseJson(runForja('clean --plan --json').stdout);
    assert.ok(result.plan, 'Must have plan field');
    assert.equal(result.plan.mode, 'dryRun');
    assert.ok(!result.state, 'Should not have execution state');
});

// Test locale is followed
test('all commands follow locale setting', () => {
    runForja('use lang zh');
    const outputs = [
        runForja('status').stdout,
        runForja('list targets').stdout,
        runForja('doctor').stdout,
    ];
    for (const output of outputs) {
        assert.match(output, /工作区：|目标：|就绪度：/);
        assert.notMatch(output, /Workspace:|Target:|Readiness:/);
    }
});
```
