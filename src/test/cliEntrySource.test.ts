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
});
test('cli user guide documents remote phase 1 without claiming build run support', () => {
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');
    assert.match(guide, /Remote 命令（Phase 1）/);
    assert.match(guide, /compilot remote test --json/);
    assert.match(guide, /compilot remote qt status --json/);
    assert.match(guide, /compilot remote sdk use --json/);
    assert.match(guide, /compilot remote qt restore --repo qt-app/);
    assert.match(guide, /远程 build\/run 仍在设计文档中/);
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
