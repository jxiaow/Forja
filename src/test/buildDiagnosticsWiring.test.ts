import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

function readSrc(...parts: string[]): string {
    return fs.readFileSync(path.join(process.cwd(), 'src', ...parts), 'utf8');
}

test('vscode diagnostics module owns a forja DiagnosticCollection cleared at build start', () => {
    const source = readSrc('vscode', 'diagnostics.ts');

    // collection source 名为 forja，随 context.subscriptions 注册销毁
    assert.match(source, /createDiagnosticCollection\('forja'\)/);
    assert.match(source, /context\.subscriptions\.push\(/);
    // 新一轮构建开始（attach tee）时清空 collection
    assert.match(source, /function attachDiagnosticsMatcher[\s\S]*?\.clear\(\)/);
    // 构建结束后用 tee buffer 全文走 core 解析器并写入 collection
    assert.match(source, /parseCompilerDiagnostics\(/);
    assert.match(source, /collection\.set\(vscode\.Uri\.file\(/);
    // buffer 按 matcher 注册，结束/异常路径都回收，防泄漏
    assert.match(source, /_rounds\.delete\(matcher\)/);
    // 不引入新的 UI 依赖（无 statusbar / webview / quickpick）
    assert.doesNotMatch(source, /createStatusBarItem|createWebviewPanel|showQuickPick/);
});

test('tee matcher buffers lines without producing matches and stays vscode-free', () => {
    const teeSrc = readSrc('vscode', 'buildOutputTee.ts');
    // 纯数据结构：不 import vscode 运行时（node 测试可直接引用）
    assert.doesNotMatch(teeSrc, /from 'vscode'/);
    // 逐行 push 进 buffer；返回 undefined 不产生 match（Problems 由 parser 独家写入）
    assert.match(teeSrc, /lines\.push\(line\)/);
    assert.match(teeSrc, /return undefined/);
    // 函数式 pattern 形状
    assert.match(teeSrc, /pattern:\s*\{[\s\S]*?pattern:\s*\(line: string\)/);
});

test('pure parser stays vscode-free and the file-capture path is fully removed', () => {
    const parser = readSrc('core', 'compilerDiagnostics.ts');
    assert.doesNotMatch(parser, /from 'vscode'/);
    // 临时文件捕获方案已删除
    assert.ok(!fs.existsSync(path.join(process.cwd(), 'src', 'core', 'buildOutputCapture.ts')));
    for (const source of [readSrc('qt', 'build', 'buildManager.ts'), readSrc('cpp', 'modules', 'cppBuilder.ts')]) {
        assert.doesNotMatch(source, /wrapCommandsWithCapture|newCaptureFile|beginBuildCapture|endBuildCapture|discardBuildCapture|captureFile/);
    }
});

test('qt buildManager runs original commands and appends the tee matcher', () => {
    const source = readSrc('qt', 'build', 'buildManager.ts');

    assert.match(source, /import \{ attachDiagnosticsMatcher, endBuildTee \} from '\.\.\/\.\.\/vscode\/diagnostics'/);
    // build() 与 run() 两处构建入口都要挂 tee 并在任务结束时收口
    const attachCount = (source.match(/attachDiagnosticsMatcher\(/g) || []).length;
    const endCount = (source.match(/endBuildTee\(tee\)/g) || []).length;
    assert.ok(attachCount >= 2, 'build() and run() must both attach a tee matcher');
    assert.ok(endCount >= 2, 'build() and run() must both end the tee');
    // 原始命令数组直接执行，无重定向包装残留
    assert.match(source, /runTask\(`Build \$\{cfg\.mode\}`, commands, _withTee\(matcher, tee\)\)/);
    assert.match(source, /builder\.makeExec\(commands\)/);
    // 成功与失败路径均写入：endBuildTee 在 exitCode === 0 分支之外先执行
    const buildStart = source.indexOf('export async function build()');
    const cleanStart = source.indexOf('export function clean()');
    const buildSource = source.slice(buildStart, cleanStart);
    const endIndex = buildSource.indexOf('endBuildTee(tee)');
    const zeroIndex = buildSource.indexOf('e.exitCode === 0');
    assert.ok(endIndex !== -1 && zeroIndex !== -1 && endIndex < zeroIndex,
        'endBuildTee must run regardless of exit code');
});

test('cpp builder executes the raw command and appends the tee matcher', () => {
    const source = readSrc('cpp', 'modules', 'cppBuilder.ts');

    // 原命令直接进 ShellExecution，恢复实时流式输出
    assert.match(source, /new vscode\.ShellExecution\(command, shellOptions\)/);
    assert.match(source, /attachDiagnosticsMatcher\(workroots\)/);
    assert.match(source, /endBuildTee\(tee\)/);
    assert.match(source, /discardBuildTee\(tee\)/);
    // tee 追加进 matcher 数组，原有 $msCompile/$gcc 保留
    assert.match(source, /\[\s*isWindows \? '\$msCompile' : '\$gcc',\s*tee\s*\]/);
    // 监听在执行前注册，避免竞态漏掉快速结束的构建
    const listenerIndex = source.indexOf('onDidEndTaskProcess');
    const executeIndex = source.indexOf('vscode.tasks.executeTask(task)');
    assert.ok(listenerIndex !== -1 && listenerIndex < executeIndex,
        'end listener must be registered before executing the task');
});

test('command layer initializes build diagnostics once during registration', () => {
    const source = readSrc('vscode', 'commands.ts');
    assert.match(source, /function registerCommands\(context: vscode\.ExtensionContext\): void \{[\s\S]{0,120}?initBuildDiagnostics\(context\);/);
});
