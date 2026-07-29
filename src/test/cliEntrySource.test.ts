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
    assert.match(spec, /当前公开子命令：`init` \| `status`/);
    assert.doesNotMatch(spec, /forja qt \.\.\./);
    assert.doesNotMatch(spec, /forja sdk \.\.\./);
});

test('cli user guide documents remote commands as implemented', () => {
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');
    assert.match(guide, /forja remote setup/);
    assert.doesNotMatch(guide, /\uFFFD/);
});

test('remote CLI bootstrap resolves artifacts from package root instead of caller cwd', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'remote', 'cli', 'index.ts'), 'utf8');
    assert.doesNotMatch(source, /findBootstrapArtifact\(process\.cwd\(\)\)/);
    assert.match(source, /findBootstrapArtifact\(findPackageRoot\(__dirname\)/);
});

test('unified CLI exposes the existing remote bootstrap workflow', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'commands', 'index.ts'), 'utf8');

    assert.match(source, /import \{ runRemoteCli \} from '\.\.\/\.\.\/remote\/cli'/);
    assert.match(source, /case 'bootstrap':[\s\S]*runRemoteCli\(\['bootstrap', '--workspace', workroot/);
});

test('remote CLI surface keeps only setup and bootstrap', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'commands', 'index.ts'), 'utf8');

    assert.match(source, /REMOTE_SUBCOMMANDS = \['setup', 'bootstrap'\]/);
    assert.doesNotMatch(source, /subCmd === 'restore'|subCmd === 'reset'/);
});

test('use help does not expose an execution-location option', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'commands', 'types.ts'), 'utf8');

    assert.doesNotMatch(source, /Set execution location/);
});

test('remote CLI only exposes bootstrap', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'remote', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /argv\[0\] !== 'bootstrap'/);
    assert.doesNotMatch(source, /executeRemoteBridge|executeRemoteTransfer|executeRemoteRestore/);
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

test('standalone CLI package includes only remote bootstrap modules', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'build-cli.js'), 'utf8');
    assert.match(source, /remote\/cli\/index\.js/);
    assert.match(source, /remote\/core\/bootstrap\.js/);
    assert.doesNotMatch(source, /'remote\/core'\s*\]/);
});

test('package channels are explicit and documented', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');

    assert.match(pkg.scripts['package:stable'], /--channel stable/);
    assert.match(pkg.scripts['package:cli:stable'], /--channel stable/);
    assert.match(pkg.scripts['package:dev'], /--channel dev/);
    assert.match(guide, /package:all:stable/);
    assert.match(guide, /package:all:dev/);
});

test('public documentation describes only the supported remote workflow', () => {
    for (const file of ['README.md', 'docs/README-cli.md', 'docs/README-vscode.md']) {
        const content = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
        assert.match(content, /远端当前仅支持工作区同步和 CLI 部署/);
        assert.doesNotMatch(content, /支持本地和远程执行/);
    }
});

test('extension package excludes retired remote execution modules', () => {
    const ignore = fs.readFileSync(path.join(process.cwd(), '.vscodeignore'), 'utf8');
    assert.match(ignore, /out\/remote\/core\/pipeline\.js/);
    assert.match(ignore, /out\/remote\/core\/status\.js/);
    assert.match(ignore, /out\/remote\/vscode\/\*\*/);
    const commands = fs.readFileSync(path.join(process.cwd(), 'src', 'vscode', 'commands.ts'), 'utf8');
    assert.doesNotMatch(commands, /remoteHelpers/);
});

test('forja skill documents current status init use flow', () => {
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'forja', 'SKILL.md'), 'utf8');

    assert.match(skill, /forja status --json/);
    assert.match(skill, /forja init --json/);
    assert.match(skill, /forja use target/);
    assert.doesNotMatch(skill, /init --project/);
    assert.doesNotMatch(skill, /sdk build --mode/);
});

test('sync command surface is minimal (plan subcommand + reset flag)', () => {
    const syncSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'commands', 'sync.ts'), 'utf8');
    const indexSrc = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'commands', 'index.ts'), 'utf8');

    // SyncAction only has run/plan/reset/status/ignore
    assert.match(syncSrc, /SyncAction\s*=\s*'run'\s*\|\s*'plan'\s*\|\s*'reset'/);
    // No transfer subcommand in dispatcher
    assert.doesNotMatch(indexSrc, /subArg === 'transfer'/);
    // --reset flag is supported
    assert.match(indexSrc, /--reset/);
});

test('sync help and docs describe sync command', () => {
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'forja', 'SKILL.md'), 'utf8');

    // sync is a top-level command in the command reference table
    assert.match(skill, /forja sync --dry-run/);
    assert.match(guide, /forja remote setup/);
});

test('sync help and docs describe server management commands', () => {
    const spec = fs.readFileSync(path.join(process.cwd(), 'docs', 'cli-interface-spec.md'), 'utf8');
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'forja', 'SKILL.md'), 'utf8');

    // In v2, spec uses the new server command
    assert.match(spec, /forja server/);
    assert.match(spec, /\| `add` \|/);
    assert.match(spec, /\| `update <id>` \|/);
    assert.match(spec, /\| `remove <id>` \|/);
    assert.match(guide, /forja server add/);
    assert.match(skill, /forja server/);
});

test('forja skill uses unified command structure', () => {
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'forja', 'SKILL.md'), 'utf8');

    // Check that sync is documented as a top-level command
    assert.match(skill, /forja sync --dry-run/);
    assert.match(skill, /## 命令速查/);
    assert.match(skill, /forja remote setup/);
});
