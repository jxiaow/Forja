import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { rccNeedsRebuild, RccTarget, RccRebuildContext } from '../qt/shared/rccResolver';
import { loadRccManifest, rccManifestPath, rccTargetKey, writeRccManifest } from '../qt/shared/rccManifest';

// 固定基准 mtime（秒），避免真实时钟干扰比较
const T0 = 1700000000;

interface Fixture {
    root: string;
    workroot: string;
    configDir: string;
    target: RccTarget;
    qrcPath: string;
    rccPath: string;
    fileA: string;
    fileB: string;
    outDir: string;
}

function setTime(filePath: string, sec: number): void {
    fs.utimesSync(filePath, sec, sec);
}

function qrcContent(refs: string[]): string {
    const body = refs.map(r => `<file>${r}</file>`).join('');
    return `<RCC><qresource prefix="/">${body}</qresource></RCC>`;
}

function setup(): Fixture {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-rcc-manifest-'));
    const workroot = path.join(root, 'workroot');
    const targetDir = path.join(workroot, 'XYRcc', 'res1');
    fs.mkdirSync(path.join(targetDir, 'icons'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'styles'), { recursive: true });
    const fileA = path.join(targetDir, 'icons', 'a.svg');
    const fileB = path.join(targetDir, 'styles', 'dark.qss');
    fs.writeFileSync(fileA, '<svg/>', 'utf8');
    fs.writeFileSync(fileB, 'QWidget{}', 'utf8');
    const qrcPath = path.join(targetDir, 'res1.qrc');
    fs.writeFileSync(qrcPath, qrcContent(['icons/a.svg', 'styles/dark.qss']), 'utf8');
    setTime(qrcPath, T0);
    setTime(fileA, T0);
    setTime(fileB, T0);
    const rccPath = path.join(targetDir, 'res1.rcc');
    fs.writeFileSync(rccPath, 'binary-stub', 'utf8');
    setTime(rccPath, T0 + 10);
    const outDir = path.join(workroot, 'build');
    fs.mkdirSync(outDir, { recursive: true });
    const outRcc = path.join(outDir, 'res1.rcc');
    fs.writeFileSync(outRcc, 'binary-stub', 'utf8');
    setTime(outRcc, T0 + 10);
    const configDir = path.join(root, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    return {
        root, workroot, configDir,
        target: { name: 'res1', dir: targetDir },
        qrcPath, rccPath, fileA, fileB, outDir,
    };
}

function teardown(f: Fixture): void {
    fs.rmSync(f.root, { recursive: true, force: true });
}

function ctxOf(f: Fixture): RccRebuildContext {
    return { workroot: f.workroot, configDir: f.configDir };
}

function withManifest(f: Fixture): void {
    writeRccManifest(f.workroot, [f.target], f.configDir);
}

test('manifest up to date: fast path skips rebuild', () => {
    const f = setup();
    try {
        withManifest(f);
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), false);
    } finally { teardown(f); }
});

test('touch changes mtime but not content: no rebuild and manifest timestamps refreshed', () => {
    const f = setup();
    try {
        withManifest(f);
        setTime(f.qrcPath, T0 + 7);
        setTime(f.fileA, T0 + 8);
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), false);
        const manifest = loadRccManifest(f.workroot, f.configDir);
        assert.ok(manifest);
        const entry = manifest.targets[rccTargetKey(f.workroot, f.target)];
        assert.equal(entry.qrc.mtimeMs, (T0 + 7) * 1000);
        const recA = entry.files.find(rec => rec.relPath.endsWith('a.svg'));
        assert.ok(recA);
        assert.equal(recA.mtimeMs, (T0 + 8) * 1000);
        // 二次判定应走快路径且仍免编
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), false);
    } finally { teardown(f); }
});

test('content change with older-than-rcc mtime still triggers rebuild via hash', () => {
    const f = setup();
    try {
        withManifest(f);
        fs.writeFileSync(f.fileA, '<svg>changed</svg>', 'utf8');
        setTime(f.fileA, T0 + 3); // 比 .rcc(T0+10) 还旧，mtime 判定会漏，哈希兜底必须抓住
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), true);
    } finally { teardown(f); }
});

test('qrc adds or removes a <file> entry triggers rebuild', () => {
    const f = setup();
    try {
        withManifest(f);
        // 新增引用
        fs.writeFileSync(path.join(f.target.dir, 'icons', 'b.svg'), '<svg2/>', 'utf8');
        fs.writeFileSync(f.qrcPath, qrcContent(['icons/a.svg', 'styles/dark.qss', 'icons/b.svg']), 'utf8');
        setTime(f.qrcPath, T0 + 2);
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), true);
        // 记录刷新后再删除引用 → 列表条数不一致，仍需重编
        withManifest(f);
        fs.writeFileSync(f.qrcPath, qrcContent(['icons/a.svg']), 'utf8');
        setTime(f.qrcPath, T0 + 2);
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), true);
    } finally { teardown(f); }
});

test('referenced file missing on disk triggers rebuild', () => {
    const f = setup();
    try {
        withManifest(f);
        fs.rmSync(f.fileA);
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), true);
    } finally { teardown(f); }
});

test('corrupted manifest JSON falls back to mtime check without throwing', () => {
    const f = setup();
    try {
        withManifest(f);
        fs.writeFileSync(rccManifestPath(f.workroot, f.configDir), '{{{ not json', 'utf8');
        // 现行 mtime 判定：全部比 .rcc 旧 → 免编，不抛
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), false);
        // 免编分支顺手补建 manifest
        const manifest = loadRccManifest(f.workroot, f.configDir);
        assert.ok(manifest);
        assert.ok(manifest.targets[rccTargetKey(f.workroot, f.target)]);
    } finally { teardown(f); }
});

test('missing .rcc output triggers rebuild even with fresh manifest', () => {
    const f = setup();
    try {
        withManifest(f);
        fs.rmSync(f.rccPath);
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), true);
    } finally { teardown(f); }
});

test('stale .rcc copy in output dir still triggers rebuild (mtime rule preserved)', () => {
    const f = setup();
    try {
        withManifest(f);
        const outRcc = path.join(f.outDir, 'res1.rcc');
        setTime(outRcc, T0 + 1); // 拷贝比 .rcc(T0+10) 旧
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), true);
        setTime(outRcc, T0 + 10);
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), false);
        fs.rmSync(outRcc); // 拷贝缺失
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), true);
    } finally { teardown(f); }
});

test('manifest entry backfilled on first no-rebuild verdict, then fast path is used', () => {
    const f = setup();
    try {
        // 首次：无 manifest → mtime 判定免编 + 补建条目
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), false);
        const manifest = loadRccManifest(f.workroot, f.configDir);
        assert.ok(manifest);
        const entry = manifest.targets[rccTargetKey(f.workroot, f.target)];
        assert.equal(entry.files.length, 2);
        // 第二次：改内容但把 mtime 拨回不晚于 .rcc → 只有哈希兜底能抓住 → 重编
        fs.writeFileSync(f.fileB, 'QPushButton{color:red}', 'utf8');
        setTime(f.fileB, T0);
        assert.equal(rccNeedsRebuild([f.target], f.outDir, ctxOf(f)), true);
    } finally { teardown(f); }
});

test('without ctx rccNeedsRebuild keeps legacy mtime behavior and writes nothing', () => {
    const f = setup();
    try {
        assert.equal(rccNeedsRebuild([f.target], f.outDir), false);
        assert.equal(fs.existsSync(path.join(f.configDir, 'rcc-manifests')), false);
    } finally { teardown(f); }
});
