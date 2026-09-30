import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseCompilerDiagnostics, resolveDiagnosticFile } from '../core/compilerDiagnostics';
import type { CompilerDiagnostic } from '../core/compilerDiagnostics';
import { createBuildOutputTee, activeTeeCount } from '../vscode/buildOutputTee';

// ── 测试夹具：真实存在的源文件，确保过滤规则按文件系统校验生效 ──
const _tmpDirs: string[] = [];
after(() => { for (const d of _tmpDirs) { fs.rmSync(d, { recursive: true, force: true }); } });

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-diag-'));
_tmpDirs.push(root);
fs.writeFileSync(path.join(root, 'main.cpp'), 'int main() {}\n', 'utf8');
fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
fs.writeFileSync(path.join(root, 'sub', 'main.cpp'), 'int f() {}\n', 'utf8');
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'file.cpp'), 'int g() {}\n', 'utf8');
fs.mkdirSync(path.join(root, 'res'), { recursive: true });
fs.writeFileSync(path.join(root, 'res', 'app.ui'), '<ui/>\n', 'utf8');
fs.writeFileSync(path.join(root, 'res', 'app.qrc'), '<qresource/>\n', 'utf8');
fs.mkdirSync(path.join(root, 'other'), { recursive: true });
fs.writeFileSync(path.join(root, 'other', 'second.cpp'), 'int h() {}\n', 'utf8');

const roots = [root];

function first(items: CompilerDiagnostic[]): CompilerDiagnostic {
    assert.ok(items.length >= 1, 'expected at least one diagnostic');
    return items[0];
}

// ── MSVC ──

test('parses english msvc error with paren position and C-code', () => {
    const items = parseCompilerDiagnostics(`main.cpp(12): error C2065: 'x': undeclared identifier`, roots);
    assert.equal(items.length, 1);
    const d = first(items);
    assert.equal(d.file, path.normalize(path.join(root, 'main.cpp')));
    assert.equal(d.line, 12);
    assert.equal(d.severity, 'error');
    assert.equal(d.code, 'C2065');
    assert.equal(d.message, "'x': undeclared identifier");
    assert.equal(d.toolchain, 'msvc');
});

test('parses msvc warning with column and space-before-colon variant', () => {
    const items = parseCompilerDiagnostics('main.cpp(7, 3) : warning C4101: \'y\': unreferenced local variable', roots);
    const d = first(items);
    assert.equal(d.severity, 'warning');
    assert.equal(d.line, 7);
    assert.equal(d.column, 3);
    assert.equal(d.code, 'C4101');
});

test('parses msvc absolute path with msbuild node prefix', () => {
    const abs = path.join(root, 'main.cpp');
    const items = parseCompilerDiagnostics(`1>${abs}(4): fatal error C1004: fatal error during build`, roots);
    const d = first(items);
    assert.equal(d.line, 4);
    assert.equal(d.severity, 'error');
    assert.equal(d.code, 'C1004');
});

test('parses localized (zh) msvc line with C-code kept english', () => {
    const items = parseCompilerDiagnostics('main.cpp(5): 错误 C2065: “foo”: 未声明的标识符', roots);
    const d = first(items);
    assert.equal(d.line, 5);
    assert.equal(d.severity, 'error');
    assert.equal(d.code, 'C2065');
    assert.match(d.message, /未声明的标识符/);
});

test('parses msvc "path(file.cpp): line 12:" keyword variant', () => {
    const items = parseCompilerDiagnostics('src(file.cpp): line 12: error C2065: "x" : undeclared', roots);
    const d = first(items);
    assert.equal(d.file, path.normalize(path.join(root, 'src', 'file.cpp')));
    assert.equal(d.line, 12);
    assert.equal(d.toolchain, 'msvc');
});

// ── GCC / Clang ──

test('parses gcc error with file:line:col: severity format', () => {
    const items = parseCompilerDiagnostics('main.cpp:12:5: error: \'x\' was not declared in this scope', roots);
    const d = first(items);
    assert.equal(d.line, 12);
    assert.equal(d.column, 5);
    assert.equal(d.severity, 'error');
    assert.equal(d.toolchain, 'gcc');
});

test('parses gcc warning with -W flag code and column', () => {
    const items = parseCompilerDiagnostics('main.cpp:3:1: warning: unused variable \'y\' [-Wunused-variable]', roots);
    const d = first(items);
    assert.equal(d.severity, 'warning');
    assert.equal(d.column, 1);
    assert.equal(d.code, '-Wunused-variable');
});

test('parses gcc error without column', () => {
    const items = parseCompilerDiagnostics('main.cpp:9: error: oops', roots);
    const d = first(items);
    assert.equal(d.line, 9);
    assert.equal(d.column, undefined);
});

test('parses gcc fatal error (missing include) as error entry', () => {
    const items = parseCompilerDiagnostics('main.cpp:1:10: fatal error: missing.h: No such file or directory', roots);
    const d = first(items);
    assert.equal(d.severity, 'error');
    assert.equal(d.line, 1);
});

test('attributes clang output to clang and ignores note lines', () => {
    const output = [
        'Android (build 8992160) clang version 14.0.7',
        'main.cpp:12:5: warning: shadowed declaration [-Wshadow]',
        'main.cpp:13:5: note: previous declaration is here',
        'main.cpp:14:2: error: use of undeclared identifier \'z\''
    ].join('\n');
    const items = parseCompilerDiagnostics(output, roots);
    assert.equal(items.length, 2, 'note lines must not produce diagnostics');
    assert.ok(items.every(d => d.toolchain === 'clang'));
    assert.ok(items.some(d => d.severity === 'warning'));
    assert.ok(items.some(d => d.severity === 'error'));
});

test('handles windows backslash relative paths on any platform', () => {
    const items = parseCompilerDiagnostics('sub\\main.cpp:3:5: error: boom', roots);
    const d = first(items);
    assert.equal(d.file, path.normalize(path.join(root, 'sub', 'main.cpp')));
    assert.equal(d.line, 3);
});

// ── 路径解析 ──

test('resolves relative paths against each provided workroot in order', () => {
    const items = parseCompilerDiagnostics('second.cpp:2:1: error: nope', [path.join(root, 'nope'), path.join(root, 'other')]);
    const d = first(items);
    assert.equal(d.file, path.normalize(path.join(root, 'other', 'second.cpp')));
});

test('resolveDiagnosticFile returns null for non-existing files', () => {
    assert.equal(resolveDiagnosticFile('ghost.cpp', roots), null);
    assert.ok(resolveDiagnosticFile('main.cpp', roots));
});

// ── 过滤规则 ──

test('filters diagnostics pointing at non-existing files (third-party noise)', () => {
    const items = parseCompilerDiagnostics('ghost.cpp:1:1: error: nope\nmissing/header.h(3): error C2065: x', roots);
    assert.equal(items.length, 0);
});

test('linker errors and make noise produce no diagnostics', () => {
    const output = [
        'main.cpp(12) : fatal error LNK1120: 1 unresolved externals',
        'ghost.obj:-1: LNK2019: unresolved external symbol referenced',
        'collect2: error: ld returned 1 exit status',
        '/usr/bin/ld: cannot find -lfoo',
        'make: *** [Makefile:123: all] Error 2',
        'make[1]: Leaving directory \'' + root + '\''
    ].join('\n');
    const items = parseCompilerDiagnostics(output, roots);
    assert.equal(items.length, 0);
});

test('duplicate identical lines are deduplicated', () => {
    const line = 'main.cpp:12:5: error: \'x\' was not declared in this scope';
    const items = parseCompilerDiagnostics([line, line].join('\n'), roots);
    assert.equal(items.length, 1);
});

// ── Qt 工具降级 ──

test('uic syntax error degrades to a line-less entry on the .ui file', () => {
    const items = parseCompilerDiagnostics('uic: Error in file res/app.ui, full parsing failed', roots);
    const d = first(items);
    assert.equal(d.file, path.normalize(path.join(root, 'res', 'app.ui')));
    assert.equal(d.line, 0);
    assert.equal(d.severity, 'error');
});

test('rcc missing resource degrades to a line-less entry on the .qrc file', () => {
    const items = parseCompilerDiagnostics('Cannot find file: logo.png (relative to res/app.qrc).', roots);
    const d = first(items);
    assert.equal(d.file, path.normalize(path.join(root, 'res', 'app.qrc')));
    assert.equal(d.line, 0);
});

test('moc positioned error parses through the gcc-style pattern', () => {
    const items = parseCompilerDiagnostics('main.cpp:8: Error: Class Foo not found', roots);
    const d = first(items);
    assert.equal(d.line, 8);
    assert.equal(d.severity, 'error');
});

test('empty output produces no diagnostics', () => {
    assert.deepEqual(parseCompilerDiagnostics('', roots), []);
});

// ── 构建输出逐行 tee（纯数据结构，无 vscode） ──

test('tee matcher buffers every output line in order', () => {
    const tee = createBuildOutputTee();
    assert.equal(tee.matcher.pattern.pattern('first line'), undefined);
    assert.equal(tee.matcher.pattern.pattern('second line'), undefined);
    assert.deepEqual(tee.finish(), ['first line', 'second line']);
});

test('tee matcher produces no problem matches', () => {
    const tee = createBuildOutputTee();
    const errorLine = 'main.cpp(12): error C2065: undeclared identifier';
    assert.equal(tee.matcher.pattern.pattern(errorLine), undefined);
    tee.finish();
});

test('tee finish deregisters: second finish returns undefined and frees the slot', () => {
    const before = activeTeeCount();
    const tee = createBuildOutputTee();
    assert.equal(activeTeeCount(), before + 1);
    tee.finish();
    assert.equal(activeTeeCount(), before);
    assert.equal(tee.finish(), undefined);
});
