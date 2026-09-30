/**
 * 端到端冒烟测试：真实驱动编译后的 CLI（out/cli/index.js）完成
 * status(未初始化) → init → use target → build → run 全链路。
 *
 * 工程形态探测（子进程实测，不硬编码平台）：
 * - POSIX 且有 make + g++/c++ → Makefile 工程（Ubuntu CI 走这条）
 * - 否则有 cmake → CMakeLists.txt 工程（Windows 上 scanner 只识别 .sln/CMakeLists.txt）
 * - 都没有 → 整组 skip 并注明原因
 *
 * 配置隔离：通过 FORJA_CONFIG_DIR 指向临时目录，~/.forja/workspaces/<hash>.json
 * （哈希规则见 core/workspaceStore.ts: sha256(normalizePath(workroot)).slice(0,12)）
 * 全部落在临时目录内，测试结束整目录删除，无遗留。
 *
 * 契约说明：`forja run` 按文档与源码（cli/commands/run.ts）仅支持 Qt/qmake 目标，
 * cpp 目标返回 ok:false + diagnostics(error) + nextAction 'forja build'。
 * 因此 run 步骤断言该真实契约，并另外直接执行 build 产物验证 hello 退出码 0。
 */
import test, { after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ── 常量 ──
const CLI_PATH = path.resolve(__dirname, '..', 'cli', 'index.js');
const HELLO_TEXT = 'hello from forja e2e';
const PROBE_TIMEOUT_MS = 10_000;
const CMD_TIMEOUT_MS = 45_000;
const BUILD_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 20_000;

// ── 临时目录（工程 workroot + 隔离配置目录） ──
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-e2e-'));
const projectRoot = path.join(scratchRoot, 'project');
const configRoot = path.join(scratchRoot, 'config');
fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(configRoot, { recursive: true });

after(() => {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
});

// ── 工具链探测 ──
interface ToolchainChoice {
    flavor: 'make' | 'cmake';
    projectFile: string;
}

function probeCommand(commandLine: string): boolean {
    const r = cp.spawnSync(commandLine, { shell: true, windowsHide: true, timeout: PROBE_TIMEOUT_MS, encoding: 'utf8' });
    return r.status === 0;
}

function probeToolchain(): ToolchainChoice | null {
    const hasMake = probeCommand('make --version');
    const hasGcc = probeCommand('g++ --version') || probeCommand('c++ --version');
    // Windows 下 cppProjectScanner 不扫描 Makefile（只扫 .sln/CMakeLists.txt），故 Makefile 仅在 POSIX 可用
    if (process.platform !== 'win32' && hasMake && hasGcc) {
        return { flavor: 'make', projectFile: 'Makefile' };
    }
    if (probeCommand('cmake --version')) {
        return { flavor: 'cmake', projectFile: 'CMakeLists.txt' };
    }
    return null;
}

const toolchain = probeToolchain();

// ── 最小 hello 工程 ──
function writeHelloProject(choice: ToolchainChoice): void {
    fs.writeFileSync(path.join(projectRoot, 'hello.cpp'),
        `#include <cstdio>\nint main() { std::printf("${HELLO_TEXT}\\n"); return 0; }\n`, 'utf8');
    if (choice.flavor === 'make') {
        fs.writeFileSync(path.join(projectRoot, 'Makefile'),
            [
                'CXX ?= g++',
                'all: hello',
                'hello: hello.cpp',
                '\t$(CXX) -o hello hello.cpp',
                'clean:',
                '\t$(RM) hello',
                '',
            ].join('\n'), 'utf8');
    } else {
        fs.writeFileSync(path.join(projectRoot, 'CMakeLists.txt'),
            [
                'cmake_minimum_required(VERSION 3.14)',
                'project(forja_e2e_smoke LANGUAGES CXX)',
                'add_executable(hello hello.cpp)',
                '',
            ].join('\n'), 'utf8');
    }
}

// ── CLI 调用 ──
interface CliResult {
    code: number;
    json: Record<string, unknown> | null;
    stdout: string;
    stderr: string;
}

function forjaEnv(): NodeJS.ProcessEnv {
    // 继承 PATH/SystemRoot 等必需变量，显式隔离配置目录并清掉可能干扰的 Forja 变量
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.FORJA_SSH_PASSWORD;
    env.FORJA_CONFIG_DIR = configRoot;
    env.FORJA_LANG = 'en';
    return env;
}

function runForja(args: string[], timeoutMs: number): CliResult {
    let stdout = '';
    let stderr = '';
    let code = 0;
    try {
        stdout = cp.execFileSync(process.execPath, [CLI_PATH, ...args], {
            cwd: projectRoot,
            env: forjaEnv(),
            encoding: 'utf8',
            windowsHide: true,
            timeout: timeoutMs,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    } catch (e) {
        const err = e as { status?: number | null; stdout?: string; stderr?: string };
        code = typeof err.status === 'number' ? err.status : 1;
        stdout = err.stdout ?? '';
        stderr = err.stderr ?? '';
    }
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(stdout) as Record<string, unknown>; } catch { /* 非 JSON 输出，由调用方断言 */ }
    return { code, json, stdout, stderr };
}

// ── 断言辅助 ──
interface Question { id: string; choices?: string[] }

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function findDiagnostic(json: Record<string, unknown>, level: string): Record<string, unknown> | undefined {
    return asArray(json.diagnostics).find(d => (d as Record<string, unknown>).level === level) as Record<string, unknown> | undefined;
}

function executableNames(): string[] {
    return process.platform === 'win32' ? ['hello.exe'] : ['hello'];
}

function findBuiltArtifact(root: string, names: string[]): string | null {
    const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (stack.length > 0) {
        const { dir, depth } = stack.pop()!;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isFile() && names.includes(entry.name)) { return full; }
            if (entry.isDirectory() && depth < 5 && entry.name !== 'CMakeFiles' && entry.name !== '.git') {
                stack.push({ dir: full, depth: depth + 1 });
            }
        }
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════
// 主链路：status → init → use target → build → run
// ═══════════════════════════════════════════════════════════════

test('e2e smoke: 编译后 CLI 完成 init→use→build→run 全链路', (t) => {
    if (!toolchain) {
        t.skip('本机探测不到可用 C++ 工具链（make+g++ 或 cmake 均不可用），跳过 e2e 全链路');
        return;
    }
    writeHelloProject(toolchain);

    // ── 1. status：未初始化，应给出 forja init 提示 ──
    const statusRes = runForja(['status', '--json'], CMD_TIMEOUT_MS);
    assert.equal(statusRes.code, 1, `未初始化时 status 应退出码 1，stderr: ${statusRes.stderr}`);
    const statusJson = statusRes.json;
    assert.ok(statusJson, 'status --json 必须输出合法 JSON');
    assert.equal(statusJson!.ok, false);
    assert.equal(statusJson!.action, 'status');
    const readiness = statusJson!.readiness as Record<string, unknown>;
    assert.equal(readiness.target, 'not-selected');
    const warnDiag = findDiagnostic(statusJson!, 'warning');
    assert.ok(warnDiag, '未初始化时应有 warning 诊断');
    assert.equal(warnDiag!.fix, 'forja init');
    assert.ok(String(statusJson!.nextAction).startsWith('forja init'), `nextAction 应指向 init，实际: ${String(statusJson!.nextAction)}`);

    // ── 2a. init（无 answers）：应返回 questions 供脚本继续 ──
    const initQ = runForja(['init', '--json', '--workroot', projectRoot], CMD_TIMEOUT_MS);
    assert.equal(initQ.code, 1, 'needs-input 时 init 退出码为 1');
    assert.ok(initQ.json, 'init --json 必须输出合法 JSON');
    assert.equal(initQ.json!.ok, false);
    const questions = asArray(initQ.json!.questions) as Question[];
    const questionIds = questions.map(q => q.id);
    assert.ok(questionIds.includes('project'), `init questions 应包含 project，实际: ${questionIds.join(',')}`);
    assert.ok(questionIds.includes('mode'), `init questions 应包含 mode，实际: ${questionIds.join(',')}`);

    // 按 questions 组装 answers（project 用测试自己写入的文件名；其余取首个候选）
    const answers: Record<string, string> = {
        project: toolchain.projectFile,
        mode: 'debug',
    };
    for (const q of questions) {
        if (q.id === 'arch' || q.id === 'vsInstall' || q.id === 'qtPath') {
            const choices = asArray(q.choices).map(String);
            assert.ok(choices.length > 0, `question ${q.id} 应带候选项`);
            answers[q.id] = q.id === 'arch' ? 'x64' : choices[0];
        }
    }
    const answersFile = path.join(scratchRoot, 'init-answers.json');
    fs.writeFileSync(answersFile, JSON.stringify(answers), 'utf8');

    // ── 2b. init --answers：注册 workroot 并创建 cpp target ──
    const initRes = runForja(['init', '--json', '--workroot', projectRoot, '--answers', answersFile], CMD_TIMEOUT_MS);
    assert.equal(initRes.code, 0, `init 应成功，stdout: ${initRes.stdout} stderr: ${initRes.stderr}`);
    assert.ok(initRes.json);
    assert.equal(initRes.json!.ok, true);
    assert.equal(initRes.json!.action, 'init');
    assert.equal(initRes.json!.registered, true);
    const initTarget = initRes.json!.target as Record<string, unknown>;
    assert.ok(initTarget, 'init 成功应返回 target');
    assert.equal(initTarget.kind, 'cpp');
    assert.equal(initTarget.project, toolchain.projectFile);
    assert.equal(initTarget.mode, 'debug');

    // ── 3. use target：选中该工程文件 ──
    const useRes = runForja(['use', 'target', '--project', toolchain.projectFile, '--json'], CMD_TIMEOUT_MS);
    assert.equal(useRes.code, 0, `use target 应成功，stdout: ${useRes.stdout} stderr: ${useRes.stderr}`);
    assert.ok(useRes.json);
    assert.equal(useRes.json!.ok, true);
    assert.equal(useRes.json!.action, 'use');
    const activeTarget = useRes.json!.activeTarget as Record<string, unknown>;
    assert.ok(activeTarget, 'use 成功应返回 activeTarget');
    assert.equal(activeTarget.project, toolchain.projectFile);
    assert.equal(activeTarget.kind, 'cpp');
    assert.ok(asArray(useRes.json!.changed).includes('activeTarget'), 'changed 应包含 activeTarget');

    // ── 4. build：断言退出码与产物存在 ──
    const expectedNames = executableNames();
    assert.equal(findBuiltArtifact(projectRoot, expectedNames), null, 'build 前不应存在产物');
    const buildRes = runForja(['build', '--json'], BUILD_TIMEOUT_MS);
    assert.equal(buildRes.code, 0, `build 应成功，stdout: ${buildRes.stdout} stderr: ${buildRes.stderr}`);
    assert.ok(buildRes.json);
    assert.equal(buildRes.json!.ok, true);
    assert.equal(buildRes.json!.action, 'build');
    assert.equal(buildRes.json!.buildAction, 'default');
    if (buildRes.json!.exitCode !== undefined) {
        assert.equal(buildRes.json!.exitCode, 0);
    }
    assert.equal(buildRes.json!.errors, undefined, '成功构建不应带 errors');
    const buildSearchRoot = toolchain.flavor === 'cmake' ? path.join(projectRoot, 'build') : projectRoot;
    const artifact = findBuiltArtifact(buildSearchRoot, expectedNames);
    assert.ok(artifact, `build 后应在 ${buildSearchRoot} 下找到产物 ${expectedNames.join('/')}`);

    // ── 5. run：cpp 目标按 CLI 契约返回 unsupported；产物另行直接执行验证 hello 退出 0 ──
    const runRes = runForja(['run', '--json'], RUN_TIMEOUT_MS);
    assert.equal(runRes.code, 1, 'cpp 目标 run 按契约应以退出码 1 返回 unsupported');
    assert.ok(runRes.json, 'run --json 必须输出合法 JSON');
    assert.equal(runRes.json!.ok, false);
    assert.equal(runRes.json!.action, 'run');
    assert.equal(runRes.json!.runAction, 'default');
    const runErrDiag = findDiagnostic(runRes.json!, 'error');
    assert.ok(runErrDiag, 'cpp run 应返回 error 级诊断');
    assert.equal(runRes.json!.nextAction, 'forja build');

    const helloRes = cp.spawnSync(artifact!, {
        cwd: projectRoot,
        env: forjaEnv(),
        encoding: 'utf8',
        timeout: RUN_TIMEOUT_MS,
        windowsHide: true,
    });
    assert.equal(helloRes.status, 0, `hello 产物应快速退出 0，stderr: ${helloRes.stderr}`);
    assert.ok(helloRes.stdout.includes(HELLO_TEXT), `hello 产物应输出 "${HELLO_TEXT}"，实际: ${helloRes.stdout}`);
});
