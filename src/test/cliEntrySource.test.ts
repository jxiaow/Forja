import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'node:child_process';

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
    assert.match(source, /remote   远程命令 .*restore/);
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

test('remote cli foreground run streams without replaying cached stdout', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'remote', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /const streamRemoteRun = options\.target === 'qt' && options\.remoteAction === 'run'/);
    assert.match(source, /stream: streamRemoteRun/);
    assert.match(source, /if \(streamRemoteRun && result\.remote\)/);
    assert.match(source, /return;\s*\}\s*writeOutput\(result, options\.json\);/);
});

test('cli interface spec lists only implemented subcommands as available', () => {
    const spec = fs.readFileSync(path.join(process.cwd(), 'docs', 'cli-interface-spec.md'), 'utf8');
    assert.match(spec, /当前已实现子命令：`qt` \| `sdk` \| `remote` \| `cleanup`/);
    assert.match(spec, /`compilot remote test` 输出结构（Phase 1）/);
    assert.match(spec, /`compilot remote qt\|sdk status\/init\/use`/);
    assert.match(spec, /`compilot remote qt\|sdk restore`/);
    assert.match(spec, /remote qt build\/clean\/qmake/);
    assert.match(spec, /remote sdk build\/rebuild\/clean/);
    assert.match(spec, /Remote prepared action 输出结构/);
    assert.match(spec, /targetReadiness -> baselinePrecheck -> acquireLock -> branchSync -> overlaySync -> baselineCheck -> remoteAction -> releaseLock/);
    assert.doesNotMatch(spec, /远程 build\/run 尚未实现/);
    assert.match(spec, /Qt 动作：`build\/clean\/qmake\/run\/stop\/ps`/);
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
    assert.match(guide, /远程 Qt\/SDK build 类动作/);
    assert.match(guide, /remote qt build\/clean\/qmake\/run\/stop\/ps/);
    assert.doesNotMatch(guide, /远程 build\/run 仍在设计文档中/);
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
        'compilot.remote.qt.runDetached',
        'compilot.remote.qt.stop',
        'compilot.remote.qt.ps',
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
    assert.match(remoteCommandsSource, /remoteAction:\s*'run'/);
    assert.match(remoteCommandsSource, /args:\s*\['--detach'\]/);
    assert.match(remoteCommandsSource, /kind:\s*'bridgeAction'.*remoteAction:\s*'ps'/s);
    assert.doesNotMatch(remoteCommandsSource, /runRemoteCli/);
});


test('remote vscode design documents phase 1 command palette scope', () => {
    const doc = fs.readFileSync(path.join(process.cwd(), 'docs', 'remote-deploy-vscode.md'), 'utf8');
    assert.match(doc, /当前 Phase 1 已提供命令面板辅助入口/);
    assert.match(doc, /执行位置（后续）/);
    assert.match(doc, /Phase 1 先接入命令面板辅助入口/);
    assert.match(doc, /Compilot Remote Qt: Build/);
    assert.match(doc, /Compilot Remote SDK: Rebuild/);
    assert.match(doc, /不贡献 Bootstrap、Qt foreground run 或 SDK run\/stop\/ps/);

    const readme = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-vscode.md'), 'utf8');
    assert.match(readme, /远程编译部署（Phase 1）/);
    assert.match(readme, /Compilot Remote: Status/);
    assert.match(readme, /Compilot Remote Qt: Build \/ Clean \/ QMake/);
    assert.match(readme, /Compilot Remote Qt: Run Detached \/ Stop \/ PS/);
    assert.match(readme, /尚未接入执行位置切换、Bootstrap、Qt foreground Terminal run/);
    assert.doesNotMatch(readme, /Run Deploy/);
    assert.doesNotMatch(readme, /完整远程编译部署流程.*仍是设计稿/);
});


test('sync cli reports remote mkdir failures before scp', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'shared', 'syncCli.ts'), 'utf8');
    assert.match(source, /ensureRemoteDir 失败/);
    assert.match(source, /创建远程目录失败/);
    assert.match(source, /continue;/);
    assert.doesNotMatch(source, /code === 0 ? resolve() : resolve()/);
});

test('remote deploy v3 action policy keeps clean in prepared pipeline', () => {
    const doc = fs.readFileSync(path.join(process.cwd(), 'docs', 'remote-deploy-v3.md'), 'utf8');
    assert.match(doc, /当前实现状态/);
    assert.match(doc, /已实现 Phase 1：.*remote qt build\/clean\/qmake\/run\/stop\/ps/);
    assert.match(doc, /后续设计：.*VSCode 执行位置切换/);
    assert.match(doc, /remote qt build\/clean\/qmake/);
    assert.match(doc, /remote sdk build\/rebuild\/clean/);
    assert.match(doc, /当前 Phase 1 不做/);
    assert.doesNotMatch(doc, /- Qt run\/stop\/ps/);
    assert.doesNotMatch(doc, /remote qt\/sdk clean` \| 必须 \| 必须 \| 否 \| 否 \| 否/);
});


test('remote smoke runner is opt-in and non destructive', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.equal(pkg.scripts['remote:smoke'], 'node scripts/remote-smoke.js');

    const runner = fs.readFileSync(path.join(process.cwd(), 'scripts', 'remote-smoke.js'), 'utf8');
    assert.match(runner, /Dry-run only/);
    assert.match(runner, /--execute/);
    assert.match(runner, /--yes is required when executing --bootstrap or --build/);
    assert.match(runner, /remote', 'status'/);
    assert.match(runner, /remote', 'test'/);
    assert.match(runner, /remote', target, 'status'/);
    assert.match(runner, /remote', target, 'build'/);
    assert.doesNotMatch(runner, /git reset/);
    assert.doesNotMatch(runner, /git clean/);
    assert.doesNotMatch(runner, /unlock/);
    assert.doesNotMatch(runner, /restore/);
});

test('remote status doc defines real ssh smoke runbook', () => {
    const doc = fs.readFileSync(path.join(process.cwd(), 'docs', 'remote-deploy-status.md'), 'utf8');
    assert.match(doc, /Real Remote Smoke/);
    assert.match(doc, /npm run remote:smoke -- --target qt --build/);
    assert.match(doc, /--execute/);
    assert.match(doc, /--bootstrap --yes/);
    assert.match(doc, /--json-dir/);
    assert.match(doc, /不执行 .*git reset/);
    assert.match(doc, /不执行 .*git clean/);
    assert.match(doc, /不执行 .*remote unlock --force/);
    assert.match(doc, /失败时停在当前 step/);

    const v3 = fs.readFileSync(path.join(process.cwd(), 'docs', 'remote-deploy-v3.md'), 'utf8');
    assert.match(v3, /真实远程 smoke 流程/);
});


test('remote smoke runner dry-run and execute guard do not require ssh', () => {
    const dryRun = spawnSync(process.execPath, ['scripts/remote-smoke.js', '--target', 'qt', '--build'], {
        cwd: process.cwd(),
        encoding: 'utf8'
    });
    assert.equal(dryRun.status, 0);
    assert.match(dryRun.stdout, /mode: dry-run/);
    assert.match(dryRun.stdout, /qt-build \[mutates remote\]/);
    assert.match(dryRun.stdout, /Dry-run only/);

    const blocked = spawnSync(process.execPath, ['scripts/remote-smoke.js', '--target', 'qt', '--build', '--execute'], {
        cwd: process.cwd(),
        encoding: 'utf8'
    });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /--yes is required when executing --bootstrap or --build/);
});
