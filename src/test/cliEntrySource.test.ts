import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('package exposes compilot bin entry', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    assert.equal(pkg.bin['compilot'], './out/cli/index.js');
});

test('cli dispatcher routes to qt and sdk subcommands', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /runQtCli/);
    assert.match(source, /runSdkCli/);
    assert.match(source, /process\.exitCode = 1/);
});

test('cli interface spec lists only implemented subcommands as available', () => {
    const spec = fs.readFileSync(path.join(process.cwd(), 'docs', 'cli-interface-spec.md'), 'utf8');
    assert.match(spec, /当前已实现子命令：`qt` \| `sdk` \| `cleanup`/);
    assert.match(spec, /Remote 模式输出结构（设计稿，暂未实现）/);
});

test('cli user guide does not document draft remote commands as implemented', () => {
    const guide = fs.readFileSync(path.join(process.cwd(), 'docs', 'README-cli.md'), 'utf8');
    assert.match(guide, /Remote 命令（设计稿，暂未实现）/);
    assert.doesNotMatch(guide, /compilot remote test --json/);
    assert.doesNotMatch(guide, /sync-config\.json/);
    assert.doesNotMatch(guide, /\uFFFD/);
});

test('qt cli entry handles parse errors as json when requested', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'cli', 'index.ts'), 'utf8');
    assert.match(source, /parseCliArgs/);
    assert.match(source, /JSON\.stringify/);
    assert.match(source, /process\.exitCode = 1/);
});
