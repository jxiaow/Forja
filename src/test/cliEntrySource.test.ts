import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('package exposes forja bin entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.equal(pkg.bin['forja'], './out/cli/index.js');
});

test('cli dispatcher routes to commands', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /runCli/);
    assert.match(source, /printHelp/);
});

test('cli interface spec lists only implemented subcommands as available', () => {
    const spec = fs.readFileSync(path.join(process.cwd(), 'docs', 'cli-interface-spec.md'), 'utf8');
    assert.match(spec, /当前公开子命令：`status` \| `setup` \| `list` \| `use` \| `server` \| `build` \| `run` \| `stop` \| `clean` \| `doctor` \| `sync`/);
    assert.doesNotMatch(spec, /forja qt \.\.\./);
    assert.doesNotMatch(spec, /forja sdk \.\.\./);
});

test('cli user guide documents remote commands as implemented', () => {
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');
    // In v2, remote status is accessed via list remote
    assert.match(guide, /forja list remote --json/);
    assert.doesNotMatch(guide, /\uFFFD/);
});

test('remote CLI bootstrap resolves artifacts from package root instead of caller cwd', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'remote', 'cli', 'index.ts'), 'utf8');
    assert.doesNotMatch(source, /findBootstrapArtifact\(process\.cwd\(\)\)/);
    assert.match(source, /findBootstrapArtifact\(cliPackageRoot\(\)\)/);
});

test('remote CLI workspace-affecting actions use staged action path', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'remote', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /if \(options\.action === 'bridge'\) \{[\s\S]*const actionRemotePath = resolveRemotePrimaryActionPath\(resolved\.config\.workspace, resolved\.config\.remotePath\)[\s\S]*executeRemoteBridge\(\{/);
    assert.match(source, /executeRemoteTransfer\(\{ remotePath: actionRemotePath/);
    assert.match(source, /executeRemoteCleanUntracked\(\{ remotePath: actionRemotePath/);
    assert.match(source, /executeRemoteRestore\(\{ remotePath: actionRemotePath/);
    assert.match(source, /executeRemoteUnlock\(\{ remotePath: actionRemotePath/);
});

test('remote source uses staged workspace naming for public flow', () => {
    const remoteDir = path.join(process.cwd(), 'src', 'remote');
    const files = fs.readdirSync(path.join(remoteDir, 'core')).filter(file => file.endsWith('.ts'));
    const combined = files
        .map(file => fs.readFileSync(path.join(remoteDir, 'core', file), 'utf8'))
        .join('\n');

    assert.ok(files.includes('stagedWorkspace.ts'));
    assert.equal(files.includes('managedWorkspace.ts'), false);
    assert.doesNotMatch(combined, /managedWorkspacePrepare/);
    assert.doesNotMatch(combined, /managedWorkspace:/);
    assert.doesNotMatch(combined, /managedWorkspace\?/);
    assert.doesNotMatch(combined, /managedWorkspaceRepoPath/);
    assert.doesNotMatch(combined, /\bmanaged:\s*boolean/);
    assert.doesNotMatch(combined, /\.managed\b/);
});

test('standalone CLI package includes remote command modules', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'build-cli.js'), 'utf8');
    assert.match(source, /'remote\/cli'/);
    assert.match(source, /'remote\/core'/);
});

test('forja skill documents current status init use flow', () => {
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'forja', 'SKILL.md'), 'utf8');

    assert.match(skill, /先 status 再动手/);
    assert.match(skill, /init 只做自动初始化/);
    assert.match(skill, /use 负责显式选择/);
    assert.match(skill, /执行命令只读配置/);
    assert.doesNotMatch(skill, /init --project/);
    assert.doesNotMatch(skill, /build --project/);
    assert.doesNotMatch(skill, /sdk build --mode/);
});

test('sync help and docs describe file-scoped sync', () => {
    const cliSource = fs.readFileSync(path.join(process.cwd(), 'src', 'sync', 'cli.ts'), 'utf8');
    const spec = fs.readFileSync(path.join(process.cwd(), 'docs', 'cli-interface-spec.md'), 'utf8');
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'forja', 'SKILL.md'), 'utf8');

    assert.match(cliSource, /--file <path>/);
    assert.match(cliSource, /forja sync --file src\/main\.cpp/);
    assert.match(spec, /--file <path>/);
    assert.match(skill, /--file <path>/);
    assert.match(skill, /单文件同步/);
});

test('sync help and docs describe top-level sync status', () => {
    const cliSource = fs.readFileSync(path.join(process.cwd(), 'src', 'sync', 'cli.ts'), 'utf8');
    const spec = fs.readFileSync(path.join(process.cwd(), 'docs', 'cli-interface-spec.md'), 'utf8');
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'forja', 'SKILL.md'), 'utf8');

    assert.match(cliSource, /forja sync status --json/);
    // In v2, sync command supports plan/reset/transfer actions with --server flag
    assert.match(spec, /`plan` \\| `status` \\| `reset` \\| `transfer`/);
    // In the new unified structure, sync status is accessed via list remote
    assert.match(guide, /forja list remote --json/);
    // In the new unified structure, sync is a top-level command in the command reference table
    assert.match(skill, /\| `sync` \|/);
    assert.match(skill, /forja list remote --json/);
});

test('sync help and docs describe server management commands', () => {
    const cliSource = fs.readFileSync(path.join(process.cwd(), 'src', 'sync', 'cli.ts'), 'utf8');
    const spec = fs.readFileSync(path.join(process.cwd(), 'docs', 'cli-interface-spec.md'), 'utf8');
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'forja', 'SKILL.md'), 'utf8');

    // cliSource still uses old sync subcommands internally (hidden compatibility)
    assert.match(cliSource, /forja sync servers --json/);
    assert.match(cliSource, /forja sync add-server/);
    // In v2, spec uses the new server command
    assert.match(spec, /forja server/);
    assert.match(spec, /\| `add` \|/);
    assert.match(spec, /\| `update <id>` \|/);
    assert.match(spec, /\| `remove <id>` \|/);
    // In v2, guide and skill use the new server command
    for (const source of [guide, skill]) {
        assert.match(source, /forja list servers --json/);
        assert.match(source, /forja server add/);
        assert.match(source, /forja server update/);
        assert.match(source, /forja server remove/);
    }
});

test('forja skill uses unified command structure', () => {
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'forja', 'SKILL.md'), 'utf8');

    // Check that sync is documented as a top-level command
    assert.match(skill, /\| `sync` \|/);
    // Check that the unified command reference section exists
    assert.match(skill, /## 命令参考/);
    // Check that use subcommands are documented
    assert.match(skill, /### use 子命令/);
});

test('qt cli entry handles parse errors as json when requested', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /parseCliArgs/);
    assert.match(source, /JSON\.stringify/);
    assert.match(source, /process\.exitCode = 1/);
});
