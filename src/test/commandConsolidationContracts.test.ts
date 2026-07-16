import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = process.cwd();

function source(relativePath: string): string {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function between(text: string, start: string, end: string): string {
    const startIndex = text.indexOf(start);
    assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
    const endIndex = text.indexOf(end, startIndex);
    assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
    return text.slice(startIndex, endIndex);
}

test('VSCode foreground remote run keeps SDK rejection before remote dispatch and passes target kind', () => {
    const commands = source('src/vscode/commands.ts');
    const runBlock = between(commands, "registerCommand('forja.run'", "registerCommand('forja.debug'");
    const normalRunBlock = runBlock.slice(runBlock.indexOf("// SDK doesn't support run - check before remote dispatch"));

    const sdkGuard = normalRunBlock.indexOf("target?.kind === 'cpp'");
    const remoteDispatch = normalRunBlock.indexOf("target?.runAt === 'remote'");
    assert.ok(sdkGuard >= 0, 'forja.run must keep the SDK unsupported guard');
    assert.ok(remoteDispatch >= 0, 'forja.run must keep remote dispatch');
    assert.ok(sdkGuard < remoteDispatch, 'SDK targets must be rejected before remote foreground run');
    assert.match(normalRunBlock, /startForegroundRemoteRun\(context,\s*workspace\(\),\s*target\.kind\)/);

    const remoteHelpers = source('src/vscode/remoteHelpers.ts');
    const foregroundBlock = between(remoteHelpers, 'async function runForegroundRemote', 'function writeDiagnosticsToTerminal');
    assert.doesNotMatch(foregroundBlock, /target:\s*'qt'/, 'foreground remote run must not hard-code Qt');
    assert.match(foregroundBlock, /target:\s*kind/);
});

test('remote diagnostics use staged actionRemotePath for path mapping', () => {
    const plan = source('src/remote/core/plan.ts');
    assert.match(plan, /actionRemotePath\?:\s*string/);
    assert.match(plan, /actionRemotePath:\s*result\.actionRemotePath/);

    const helpers = source('src/vscode/remoteHelpers.ts');
    const publishBlock = between(helpers, 'function publishProblemsIfApplicable', '\n}');
    assert.match(publishBlock, /result\.actionRemotePath\s*\|\|\s*workspace/);
    assert.match(publishBlock, /publishRemoteProblems\(remoteDiagnostics,\s*workspace,\s*remotePath,\s*source\)/);
    assert.doesNotMatch(publishBlock, /publishRemoteProblems\(remoteDiagnostics,\s*workspace,\s*workspace/);
});

test('doctor and list env expose POSIX make through typed imports and blocking diagnostics', () => {
    const doctor = source('src/cli/commands/doctor.ts');
    const list = source('src/cli/commands/list.ts');

    assert.match(doctor, /import\s+\{\s*detectMake\s*\}\s+from\s+'..\/..\/sdk\/cli\/envDetector'/);
    assert.doesNotMatch(doctor, /require\('..\/..\/sdk\/cli\/envDetector'\)/);
    assert.doesNotMatch(doctor, /check\('toolchain-make',\s*'warning'/);
    assert.doesNotMatch(doctor, /check\('toolchain-make',\s*'warning'/);
    assert.match(doctor, /check\('toolchain-make',\s*'blocked'/);
    assert.match(doctor, /diag\('error',\s*T\('doctorMakeNotFound'\)\)/);

    assert.match(list, /import\s+\{[^}]*detectMake[^}]*\}\s+from\s+'..\/..\/sdk\/cli\/envDetector'/);
    assert.doesNotMatch(list, /require\('..\/..\/sdk\/cli\/envDetector'\)/);
    assert.match(list, /env\.make/);
});

test('doctor active target validation preserves absolute project paths', () => {
    const doctor = source('src/cli/commands/doctor.ts');
    const targetBlock = between(doctor, '// ── Target check ──', '// ── Toolchain checks ──');

    assert.match(targetBlock, /path\.isAbsolute\(activeTarget\.project\)/);
    assert.doesNotMatch(targetBlock, /const\s+projectPath\s*=\s*path\.join\(workspace,\s*activeTarget\.project\)/);
});

test('status remote readiness does not report ok=true with an error for default remote Forja bin', () => {
    const status = source('src/cli/commands/status.ts');
    const remoteBlock = between(status, '// ── Remote readiness ──', '// ── Build result ──');
    const remoteForjaBlock = between(remoteBlock, "// Check remote Forja bin", '});');

    assert.doesNotMatch(remoteForjaBlock, /level:\s*'error'/);
    assert.match(remoteForjaBlock, /level:\s*'info'/);
});

test('status POSIX SDK next action does not suggest unsupported project selection command', () => {
    const status = source('src/cli/commands/status.ts');

    assert.doesNotMatch(status, /forja use sdk --project <path>/);
    assert.match(status, /forja list env/);
});
