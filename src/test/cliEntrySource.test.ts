import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('package exposes forja bin entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.equal(pkg.bin['forja'], './out/cli/index.js');
});

test('cli dispatcher routes to qt, sdk, and sync subcommands', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /runQtCli/);
    assert.match(source, /runSdkCli/);
    assert.match(source, /runSyncCli/);
    assert.match(source, /process\.exitCode = 1/);
});

test('cli interface spec lists only implemented subcommands as available', () => {
    const spec = fs.readFileSync(path.join(process.cwd(), 'docs', 'cli-interface-spec.md'), 'utf8');
    assert.match(spec, /当前已实现子命令：`qt` \| `sdk` \| `sync` \| `cleanup`/);
    assert.match(spec, /Remote 模式输出结构（设计稿，暂未实现）/);
});

test('cli user guide does not document draft remote commands as implemented', () => {
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');
    assert.doesNotMatch(guide, /forja remote/);
    assert.doesNotMatch(guide, /\uFFFD/);
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
    assert.match(spec, /`status` \| `--workspace`, `--json`, `--server`/);
    assert.match(guide, /forja sync status --json/);
    assert.match(skill, /## Sync 命令/);
    assert.match(skill, /forja sync status --json/);
});

test('sync help and docs describe server management commands', () => {
    const cliSource = fs.readFileSync(path.join(process.cwd(), 'src', 'sync', 'cli.ts'), 'utf8');
    const spec = fs.readFileSync(path.join(process.cwd(), 'docs', 'cli-interface-spec.md'), 'utf8');
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'forja', 'SKILL.md'), 'utf8');

    for (const source of [cliSource, spec, guide, skill]) {
        assert.match(source, /forja sync servers --json/);
        assert.match(source, /forja sync add-server/);
        assert.match(source, /forja sync update-server/);
        assert.match(source, /forja sync remove-server/);
    }
});

test('forja skill keeps sync outside the Qt command table', () => {
    const skill = fs.readFileSync(path.join(process.cwd(), 'skills', 'forja', 'SKILL.md'), 'utf8');
    const qtSection = skill.slice(skill.indexOf('## Qt 命令'), skill.indexOf('## SDK 命令'));

    assert.doesNotMatch(qtSection, /\| `sync` \|/);
    assert.match(skill, /## Sync 命令/);
});

test('qt cli entry handles parse errors as json when requested', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /parseCliArgs/);
    assert.match(source, /JSON\.stringify/);
    assert.match(source, /process\.exitCode = 1/);
});
