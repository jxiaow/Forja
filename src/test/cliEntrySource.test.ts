import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('package exposes compilot bin entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.equal(pkg.bin['compilot'], './out/cli/index.js');
});

test('cli dispatcher routes to qt sdk and remote subcommands', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /runQtCli/);
    assert.match(source, /runSdkCli/);
    assert.match(source, /runRemoteCli/);
    assert.match(source, /remote   远程命令 .*build/);
    assert.match(source, /process\.exitCode = 1/);
});

test('remote cli wires test bootstrap to artifact upload path', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'remote', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /options.bootstrap/);
    assert.match(source, /findBootstrapArtifact/);
    assert.match(source, /createScpUploader/);
    assert.match(source, /executeRemoteRestore/);
    assert.match(source, /buildRemoteTest\(\{\s*workspace: options\.workspace,\s*bootstrap:/);
});

test('cli interface spec lists only implemented subcommands as available', () => {
    const spec = fs.readFileSync(path.join(process.cwd(), 'docs', 'cli-interface-spec.md'), 'utf8');
    assert.match(spec, /当前已实现子命令：`qt` \| `sdk` \| `remote` \| `cleanup`/);
    assert.match(spec, /`compilot remote test` 输出结构（Phase 1）/);
    assert.match(spec, /`compilot remote qt\|sdk status\/init\/use`/);
    assert.match(spec, /`compilot remote qt\|sdk restore`/);
    assert.match(spec, /remote qt build\/clean\/qmake/);
    assert.match(spec, /remote sdk build\/rebuild\/clean/);
});
test('cli user guide documents remote phase 1 prepared build support without run support', () => {
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');
    assert.match(guide, /Remote 命令（Phase 1）/);
    assert.match(guide, /compilot remote test --json/);
    assert.match(guide, /compilot remote qt status --json/);
    assert.match(guide, /compilot remote sdk use --json/);
    assert.match(guide, /compilot remote qt build --json/);
    assert.match(guide, /compilot remote sdk rebuild --json/);
    assert.match(guide, /compilot remote qt restore --repo qt-app/);
    assert.match(guide, /remote qt run\/stop\/ps/);
    assert.doesNotMatch(guide, /sync-config\.json/);
    assert.doesNotMatch(guide, /\uFFFD/);
});

test('compilot skill documents current status init use flow', () => {
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'compilot', 'SKILL.md'), 'utf8');

    assert.match(skill, /先 status 再动手/);
    assert.match(skill, /init 只做自动初始化/);
    assert.match(skill, /use 负责显式选择/);
    assert.match(skill, /执行命令只读配置/);
    assert.doesNotMatch(skill, /init --project/);
    assert.doesNotMatch(skill, /build --project/);
    assert.doesNotMatch(skill, /sdk build --mode/);
});

test('qt cli entry handles parse errors as json when requested', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /parseCliArgs/);
    assert.match(source, /JSON\.stringify/);
    assert.match(source, /process\.exitCode = 1/);
});


test('vscode extension contributes and registers remote phase 1 commands', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const commands = pkg.contributes.commands.map((item: { command: string }) => item.command);
    const expected = [
        'compilot.remote.status',
        'compilot.remote.test',
        'compilot.remote.qt.build',
        'compilot.remote.qt.clean',
        'compilot.remote.qt.qmake',
        'compilot.remote.sdk.build',
        'compilot.remote.sdk.rebuild',
        'compilot.remote.sdk.clean'
    ];

    for (const id of expected) {
        assert.ok(commands.includes(id), id + ' should be contributed');
    }
    assert.equal(commands.includes('compilot.remote.qt.run'), false);
    assert.equal(commands.includes('compilot.remote.sdk.run'), false);

    const extensionSource = fs.readFileSync(path.join(process.cwd(), 'src', 'extension.ts'), 'utf8');
    assert.match(extensionSource, /registerRemoteCommands\(context\)/);

    const remoteCommandsPath = path.join(process.cwd(), 'src', 'remote', 'vscode', 'commands.ts');
    assert.equal(fs.existsSync(remoteCommandsPath), true);
    const remoteCommandsSource = fs.readFileSync(remoteCommandsPath, 'utf8');
    assert.match(remoteCommandsSource, /executePreparedRemoteAction/);
    assert.doesNotMatch(remoteCommandsSource, /findBootstrapArtifact/);
    assert.match(remoteCommandsSource, /buildRemoteStatus/);
    assert.match(remoteCommandsSource, /buildRemoteTest/);
    assert.match(remoteCommandsSource, /const preflight = await buildRemoteTest/);
    assert.doesNotMatch(remoteCommandsSource, /remoteAction:\s*'run'/);
    assert.doesNotMatch(remoteCommandsSource, /runRemoteCli/);
});


test('remote vscode design documents phase 1 command palette scope', () => {
    const doc = fs.readFileSync(path.join(process.cwd(), 'docs', 'remote-deploy-vscode.md'), 'utf8');
    assert.match(doc, /Phase 1 先接入命令面板辅助入口/);
    assert.match(doc, /Compilot Remote Qt: Build/);
    assert.match(doc, /Compilot Remote SDK: Rebuild/);
    assert.match(doc, /不贡献 Bootstrap、Qt run\/stop\/ps 或 SDK run\/stop\/ps/);
});
