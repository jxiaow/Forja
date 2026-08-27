/**
 * CLI 命令深度集成测试
 *
 * 覆盖场景：
 * 1. 输出格式一致性 - 文本/JSON 格式精确匹配规范
 * 2. 状态变更正确性 - 命令执行后状态真的变了
 * 3. NextActions 场景覆盖 - 不同状态下 nextActions 正确
 * 4. 命令间数据一致性 - command A 输出在 command B 中一致
 * 5. --plan 模式正确性 - 不执行实际操作，只返回计划
 * 6. i18n 正确性 - 所有输出跟随 locale
 * 7. 路径分隔符一致性 - current 字段正确匹配
 */
import test, { after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { formatListText } from '../cli/commands/list';
import { formatStatusText, StatusResult } from '../cli/commands/status';
import { formatUseTargetText } from '../cli/commands/useTarget/report';
import { setGlobalLocale } from '../cli/commands/types';
import { runRemoteSetup } from '../cli/commands/remote';
import { getServerById } from '../core/serverStore';

// ── 测试环境 ──
const TEST_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'forja-deep-test-'));
const OLD_CONFIG = process.env.FORJA_CONFIG_DIR;
const CONFIG_DIR = path.join(TEST_DIR, 'config');
fs.mkdirSync(CONFIG_DIR);
process.env.FORJA_CONFIG_DIR = CONFIG_DIR;

const cleanup = () => {
    process.env.FORJA_CONFIG_DIR = OLD_CONFIG;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
};

function run(args: string, cwd?: string): { code: number; out: string; err: string } {
    const cliPath = path.join(process.cwd(), 'out', 'cli', 'index.js');
    const argv = (args.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(value => {
        const quoted = (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"));
        return quoted ? value.slice(1, -1) : value;
    });
    try {
        const out = execFileSync(process.execPath, [cliPath, ...argv], {
            cwd: cwd || TEST_DIR,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30000,
        });
        return { code: 0, out, err: '' };
    } catch (e: unknown) {
        const err = e as { status?: number; stdout?: string; stderr?: string };
        return { code: err.status || 1, out: err.stdout || '', err: err.stderr || '' };
    }
}

function json(args: string, cwd?: string) {
    const r = run(`${args} --json`, cwd);
    try { return JSON.parse(r.out); } catch { return null; }
}

after(cleanup);

// ═══════════════════════════════════════════════════════════════
// 1. --plan 模式测试（Bug #5/#7/#8/#10）
// ═══════════════════════════════════════════════════════════════

test('build --plan 返回 plan 字段而不执行', () => {
    const j = json('build --plan');
    assert.ok(j, '必须返回有效 JSON');
    // 有 target 时 plan 必须成功并返回 plan 字段
    // 无 target 时 ok=false 也是正确的（不能 plan 没有 target 的构建）
    if (j.ok) {
        assert.ok(j.plan, '必须包含 plan 字段');
        assert.equal(j.plan.mode, 'dryRun', 'plan.mode 必须是 dryRun');
        assert.ok(j.plan.commands || j.plan.shellCommand, 'plan 必须包含 commands 或 shellCommand');
    }
});

test('clean --plan 返回 plan 字段而不执行', () => {
    const j = json('clean --plan');
    assert.ok(j, '必须返回有效 JSON');
    if (j.ok) {
        assert.ok(j.plan, '必须包含 plan 字段');
        assert.equal(j.plan.mode, 'dryRun');
    }
});

test('run --plan 返回 plan 字段而不执行', () => {
    const j = json('run --plan');
    assert.ok(j, '必须返回有效 JSON');
    // run 可能因为没有 target 而失败，但如果成功必须有 plan
    if (j.ok) {
        assert.ok(j.plan, '成功的 plan 模式必须包含 plan 字段');
        assert.equal(j.plan.mode, 'dryRun');
    }
});

test('init --json 返回初始化结果', () => {
    const j = json('init');
    assert.ok(j, '必须返回有效 JSON');
    assert.equal(j.action, 'init');
});

// ═══════════════════════════════════════════════════════════════
// 2. 路径分隔符一致性（Bug #1/#2）
// ════════════════════════════════════════════════════════════

test('list targets current 与 status activeTarget 一致', () => {
    const statusJ = json('status');
    const listJ = json('list targets --all');

    if (statusJ.activeTarget) {
        // 规范化路径比较
        const activeProject = statusJ.activeTarget.project.replace(/\\/g, '/');
        const currentTarget = (Object.values(listJ.targetGroups || {}).flat() as Array<{ current?: boolean; project: string }>)
            .find((t: { current?: boolean }) => t.current === true);

        assert.ok(currentTarget, 'list targets 必须有一个 current=true 的目标');
        const currentProject = currentTarget.project.replace(/\\/g, '/');
        assert.equal(currentProject, activeProject,
            `status activeTarget.project (${activeProject}) 必须与 list targets current (${currentProject}) 一致`);
    }
});

// ═══════════════════════════════════════════════════════════════
// 3. i18n 正确性（Bug #4/#6）
// ════════════════════════════════════════════════════════════

test('status 输出跟随 locale', () => {
    const zh = run('status --lang zh');
    assert.match(zh.out, /工作区/, '中文 status 必须包含"工作区"');

    const en = run('status --lang en');
    assert.match(en.out, /Workspace/, '英文 status 必须包含"Workspace"');
});

// ═══════════════════════════════════════════════════════════════
// 4. 输出格式一致性（Bug #3/#9/#11）
// ═══════════════════════════════════════════════════════════

test('文本输出标签后紧跟值（无多余空格）', () => {
    const r = run('status --lang zh');
    const lines = r.out.trim().split('\n');

    for (const line of lines) {
        // 中文标签（以：结尾）后面应该直接跟值
        if (line.includes('：')) {
            // ：后面不应该有多个连续空格（缩进除外）
            const afterColon = line.split('：')[1];
            if (afterColon && !line.startsWith(' ')) {
                assert.doesNotMatch(afterColon, /^ {2}/,
                    `中文标签后不应有多余空格: ${line}`);
            }
        }
    }
});

// ═══════════════════════════════════════════════════════════════
// 5. 状态变更正确性
// ════════════════════════════════════════════════════════════

test('server add → list servers 能看到', () => {
    const name = `test-srv-${Date.now()}`;
    const addResult = json(`server add --name ${name} --host 127.0.0.1 --username testuser`);
    assert.ok(addResult.ok, 'add 必须成功');

    const listResult = json('server');
    const found = listResult.servers?.find((s: { name?: string }) => s.name === name);
    assert.ok(found, `list servers 必须包含 ${name}`);
    assert.equal(found.host, '127.0.0.1');

    // 清理
    run(`server remove ${found.id} --force`);
});

test('server update 实际修改了数据', () => {
    const name = `update-test-${Date.now()}`;
    const addResult = json(`server add --name ${name} --host 1.1.1.1 --username u1`);
    assert.ok(addResult.ok);

    const updateResult = json(`server update ${addResult.server.id} --host 2.2.2.2`);
    assert.ok(updateResult.ok);

    const listResult = json('server');
    const found = listResult.servers?.find((s: { id?: string }) => s.id === addResult.server.id);
    assert.equal(found?.host, '2.2.2.2', 'host 必须已更新');

    run(`server remove ${addResult.server.id} --force`);
});

test('--lang 全局 flag 切换输出语言', () => {
    const zhResult = run('status --lang zh');
    assert.match(zhResult.out, /工作区/, '中文输出必须包含"工作区"');

    const enResult = run('status --lang en');
    assert.match(enResult.out, /Workspace/, '英文输出必须包含"Workspace"');
});

// ═══════════════════════════════════════════════════════════════
// 6. NextActions 场景覆盖
// ════════════════════════════════════════════════════════════

test('status nextAction: 有 server 时显示实际名称', () => {
    const name = `nextaction-test-${Date.now()}`;
    const addResult = json(`server add --name ${name} --host 1.2.3.4 --username u`);
    assert.ok(addResult.ok);

    const statusResult = json('status');
    const nextAction = statusResult.nextAction as string | undefined;

    if (nextAction && nextAction.includes('forja remote')) {
        const serverCount = json('server').servers?.length || 0;
        if (serverCount === 1) {
            assert.ok(nextAction.includes(name), `nextAction 必须包含 server 名 ${name}`);
            assert.ok(!nextAction.includes('<name>'), '单个 server 时不应显示 <name>');
        }
    }

    run(`server remove ${addResult.server.id} --force`);
});

test('server nextActions: <=5 个显示名字列表', () => {
    const beforeCount = json('server').servers?.length || 0;
    const names: string[] = [];
    const ids: string[] = [];

    if (beforeCount < 5) {
        const toAdd = Math.min(3, 5 - beforeCount);
        for (let i = 0; i < toAdd; i++) {
            const name = `list-test-${i}-${Date.now()}`;
            const r = json(`server add --name ${name} --host 1.1.1.1 --username u`);
            if (r.ok) { names.push(name); ids.push(r.server.id); }
        }
    }

    const listResult = json('server');
    const totalServers = listResult.servers?.length || 0;
    const remoteAction = listResult.nextAction;

    if (remoteAction && remoteAction.includes('forja remote') && totalServers <= 5 && names.length > 0) {
        for (const name of names) {
            assert.ok(remoteAction.includes(name), `nextAction 必须包含 ${name}`);
        }
    } else if (remoteAction && remoteAction.includes('forja remote') && totalServers > 5) {
        assert.match(remoteAction, /--server <name>/, '超过 5 个应显示 <name>');
    }

    for (const id of ids) { run(`server remove ${id} --force`); }
});

// ═══════════════════════════════════════════════════════════════
// 7. 错误处理
// ════════════════════════════════════════════════════════════

test('未知命令返回正确错误结构', () => {
    const r = json('nonexistent');
    assert.ok(r);
    assert.equal(r.ok, false);
    assert.ok(r.diagnostics?.length > 0);
    assert.equal(r.diagnostics[0].level, 'error');
    assert.ok(r.diagnostics[0].level, 'diagnostic must have a level');
});

test('未知参数返回正确错误结构', () => {
    const r = json('status --bad-flag');
    assert.ok(r);
    assert.equal(r.ok, false);
    assert.match(r.diagnostics[0].message, /bad-flag|--unknown|Unknown/i);
});

test('JSON 输出的 nextAction 保留 --json', () => {
    const r = json('status --bad-flag');
    assert.ok(r);
    assert.match(r.nextAction || '', /--json$/);
});

// ═══════════════════════════════════════════════════════════════
// 8. JSON 输出完整性
// ════════════════════════════════════════════════════════════

test('status JSON 结构完整', () => {
    const j = json('status');
    assert.ok(j);
    assert.equal(typeof j.ok, 'boolean');
    assert.equal(j.action, 'status');
    assert.ok(j.workspace);
    assert.ok(j.readiness);

    const validStates = ['ready', 'configured', 'blocked', 'missing', 'unknown', 'not-selected'];
    for (const key of ['target', 'toolchain', 'sync', 'remote']) {
        if (j.readiness[key]) {
            assert.ok(validStates.includes(j.readiness[key]),
                `readiness.${key} 必须是有效状态`);
        }
    }
});

test('所有 list 分类返回有效 JSON', () => {
    const categories = ['targets', 'env'];
    for (const cat of categories) {
        const j = json(`list ${cat}`);
        assert.ok(j, `list ${cat} 必须返回有效 JSON`);
        assert.equal(j.action, 'list');
        assert.equal(j.category, cat);
    }
});

// ═══════════════════════════════════════════════════════════════
// 9. Server CRUD 完整流程
// ═══════════════════════════════════════════════════════════════

test('server 完整 CRUD 流程', () => {
    const name = `crud-test-${Date.now()}`;

    // Create
    const addResult = json(`server add --name ${name} --host 10.0.0.1 --username testuser --port 2222`);
    assert.ok(addResult.ok, 'add 必须成功');
    assert.equal(addResult.serverAction, 'add');
    assert.equal(addResult.server.name, name);
    assert.equal(addResult.server.host, '10.0.0.1');
    assert.equal(addResult.server.port, 2222);
    const serverId = addResult.server.id;

    // Read
    const listResult = json('server');
    const found = listResult.servers.find((s: { id?: string }) => s.id === serverId);
    assert.ok(found, 'list 必须包含新创建的 server');
    assert.equal(found.name, name);

    // Update
    const updateResult = json(`server update ${serverId} --host 192.168.1.1 --port 3333`);
    assert.ok(updateResult.ok, 'update 必须成功');
    assert.equal(updateResult.serverAction, 'update');

    // Verify update
    const afterUpdate = json('server');
    const updated = afterUpdate.servers.find((s: { id?: string }) => s.id === serverId);
    assert.equal(updated.host, '192.168.1.1', 'host 必须已更新');
    assert.equal(updated.port, 3333, 'port 必须已更新');

    // Delete
    const removeResult = json(`server remove ${serverId} --force`);
    assert.ok(removeResult.ok, 'remove 必须成功');
    assert.equal(removeResult.serverAction, 'remove');

    // Verify delete
    const afterRemove = json('server');
    const stillThere = afterRemove.servers.find((s: { id?: string }) => s.id === serverId);
    assert.ok(!stillThere, 'server 必须已删除');
});

test('server add 缺少必填参数报错', () => {
    const r = json('server add --name incomplete');
    assert.ok(r);
    assert.equal(r.ok, false);
    assert.ok(r.diagnostics?.length > 0, '必须有错误诊断');
});

test('server remove 不存在的 ID 报错', () => {
    const r = json('server remove nonexistent-id-12345 --force');
    assert.ok(r);
    assert.equal(r.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 10. Use 子命令测试
// ═══════════════════════════════════════════════════════════════

test('use target rejects an unknown option', () => {
    const r = json('use target --execution local');
    assert.ok(r);
    assert.equal(r.ok, false);
    assert.match(r.diagnostics?.[0]?.message || '', /--execution/);
});

test('remote setup configures sync and records the server path', () => {
    // 先创建服务器
    const name = `remote-test-${Date.now()}`;
    const addResult = json(`server add --name ${name} --host 1.2.3.4 --username u`);
    assert.ok(addResult.ok);

    const r = runRemoteSetup(TEST_DIR, { server: name, remotePath: '/srv/projects/cli-app' });
    assert.equal(r.ok, true);
    assert.deepEqual(getServerById(addResult.server.id)?.remotePathHistory, ['/srv/projects/cli-app']);

    // 清理
    run(`server remove ${addResult.server.id} --force`);
});

test('remote setup rejects a missing server', () => {
    const r = runRemoteSetup(TEST_DIR, { server: 'nonexistent-server', remotePath: '/srv/projects/cli-app' });
    assert.equal(r.ok, false);
});

test('remote setup rejects a blank remote path', () => {
    const r = runRemoteSetup(TEST_DIR, { server: 'nonexistent-server', remotePath: '   ' });
    assert.equal(r.ok, false);
    assert.match(r.diagnostics?.[0]?.message ?? '', /path is required/i);
});

test('status 工具链摘要按实际可执行文件区分 make 和 jom', () => {
    setGlobalLocale('zh');
    const base: StatusResult = {
        ok: true,
        action: 'status',
        workspace: '/workspace/app',
        activeTarget: {
            id: 'qt-app-release-x64',
            name: 'qt-app',
            kind: 'qt',
            project: 'app.pro',
            mode: 'release',
            arch: 'x64',
            toolchain: {
                qtPath: '/usr/local/qt5.13.2',
                qtVersion: '5.13.2',
                jomPath: '/usr/bin/make',
            },
        },
        readiness: { target: 'ready', toolchain: 'ready' },
        diagnostics: [],
    };

    const makeText = formatStatusText(base, 'zh');
    assert.match(makeText, /工具链: .*make/);
    assert.doesNotMatch(makeText, /工具链: .*jom/);

    const jomText = formatStatusText({
        ...base,
        activeTarget: {
            ...base.activeTarget!,
            toolchain: { ...base.activeTarget!.toolchain, jomPath: 'C:\\Qt\\Tools\\jom\\jom.exe' },
        },
    }, 'zh');
    assert.match(jomText, /工具链: .*jom/);
});

test('remote bootstrap is routed to the existing bootstrap workflow', () => {
    const workspace = fs.mkdtempSync(path.join(require('os').tmpdir(), 'forja-bootstrap-no-server-'));
    try {
        const text = run('remote bootstrap', workspace);
        assert.equal(text.code, 1);
        assert.deepEqual(text.out.trimEnd().split(/\r?\n/), [
            'Error',
            '  error: No server selected',
            '',
            'Next',
            '  forja remote setup --server <name> --remote-path <path>',
        ]);

        const r = json('remote bootstrap', workspace);
        assert.ok(r);
        assert.equal(r.action, 'bootstrap');
        assert.equal(r.ok, false);
        assert.equal(r.nextAction, 'forja remote setup --server <name> --remote-path <path>');
        assert.doesNotMatch(r.diagnostics?.[0]?.message ?? '', /unknown remote|未知 remote/i);

        const forced = json('remote bootstrap --force', workspace);
        assert.ok(forced);
        assert.equal(forced.action, 'bootstrap');
        assert.equal(forced.ok, false);
        assert.doesNotMatch(forced.diagnostics?.[0]?.message ?? '', /--force.*只能用于/i);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

// ═══════════════════════════════════════════════════════════════
// 11. List 详细功能测试
// ═════════════════════════════════════════════════════════════

test('removed remote subcommands and doctor remote actions are rejected', () => {
    for (const args of ['remote restore repo path', 'remote reset repo path', 'doctor --remote', 'doctor unlock stale-lock']) {
        const r = json(args);
        assert.ok(r, `${args} must return JSON`);
        assert.equal(r.ok, false, `${args} must be rejected`);
    }
});

test('server --detail 显示服务器详情', () => {
    // 创建服务器
    const name = `detail-test-${Date.now()}`;
    const addResult = json(`server add --name ${name} --host 5.6.7.8 --username detailuser`);
    assert.ok(addResult.ok);

    // 查看详情
    const r = run(`server --detail ${addResult.server.id}`);
    assert.equal(r.code, 0);
    assert.match(r.out, new RegExp(name), '必须包含服务器名');
    assert.match(r.out, /5\.6\.7\.8/, '必须包含 host');
    assert.match(r.out, /detailuser/, '必须包含 username');

    // 清理
    run(`server remove ${addResult.server.id} --force`);
});

test('list targets --all 显示项目信息', () => {
    const r = json('list targets --all');
    assert.ok(r);
    assert.equal(r.action, 'list');
    assert.equal(r.category, 'targets');
    assert.ok(r.targetGroups && typeof r.targetGroups === 'object', 'targetGroups 必须是对象');

    // 每个 target 必须有必要字段，分组信息只由父级 key 表达
    for (const t of Object.values(r.targetGroups).flat() as Array<{
        kind?: string;
        group?: string;
        project?: string;
        current?: boolean;
        configured?: boolean;
    }>) {
        assert.ok(t.kind, 'target 必须有 kind');
        assert.ok(t.project, 'target 必须有 project');
        assert.equal(t.group, undefined, 'target 不应重复携带父级 group');
        assert.ok(typeof t.current === 'boolean', 'target 必须有 current 布尔值');
        assert.ok(typeof t.configured === 'boolean', 'target 必须有 configured 布尔值');
    }
});

test('list targets --all safely groups prototype-like directory names', async () => {
    const { runList } = require('../cli/commands/list');
    const workspace = fs.mkdtempSync(path.join(TEST_DIR, 'prototype-groups-'));
    for (const group of ['constructor', '__proto__']) {
        const projectDir = path.join(workspace, group);
        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    }

    try {
        const result = await runList(workspace, 'targets', { savedOnly: false });
        assert.ok(Object.prototype.hasOwnProperty.call(result.targetGroups || {}, 'constructor'));
        assert.ok(Object.prototype.hasOwnProperty.call(result.targetGroups || {}, '__proto__'));
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('list targets text distinguishes saved mode and arch variants', () => {
    setGlobalLocale('en');
    const text = formatListText({
        ok: true,
        action: 'list',
        category: 'targets',
        savedTargets: [
            { id: 'qt-app-debug-x64', name: 'app debug x64', kind: 'qt', project: 'app.pro', mode: 'debug', arch: 'x64', active: true },
            { id: 'qt-app-release-x64', name: 'app release x64', kind: 'qt', project: 'app.pro', mode: 'release', arch: 'x64', active: false },
        ],
    }, 'en');

    assert.match(text, /app\s+debug\|x64\s+—\s+app\.pro/);
    assert.match(text, /app\s+release\|x64\s+—\s+app\.pro/);
});

test('list targets text shows buildScript when set', () => {
    setGlobalLocale('en');
    const text = formatListText({
        ok: true,
        action: 'list',
        category: 'targets',
        savedTargets: [
            { id: 'cpp-app-debug-x64', name: 'app debug x64', kind: 'cpp', project: 'CMakeLists.txt', buildScript: 'build.sh', mode: 'debug', arch: 'x64', active: true },
        ],
    }, 'en');

    assert.match(text, /—\s+build\.sh/);
    assert.doesNotMatch(text, /—\s+CMakeLists\.txt/);
});

test('status target line shows buildScript when set', () => {
    setGlobalLocale('en');
    const base: StatusResult = {
        ok: true,
        action: 'status',
        workspace: '/workspace/app',
        activeTarget: {
            id: 'cpp-app-debug-x64',
            name: 'cpp-app',
            kind: 'cpp',
            project: 'app.sln',
            buildScript: 'build_all.sh',
            mode: 'debug',
            arch: 'x64',
            toolchain: {},
        },
        readiness: { target: 'ready', toolchain: 'ready' },
        diagnostics: [],
    };

    const text = formatStatusText(base, 'en');
    assert.match(text, /target:.*build_all\.sh/i);
    assert.doesNotMatch(text, /target:.*app\.sln/i);
});

test('formatUseTargetText shows buildScript when set', () => {
    setGlobalLocale('en');
    const text = formatUseTargetText({
        ok: true,
        action: 'use',
        useScope: 'target',
        workspace: '/workspace/app',
        activeTarget: {
            id: 'cpp-app-debug-x64',
            name: 'cpp-app',
            kind: 'cpp',
            project: 'CMakeLists.txt',
            buildScript: 'build.sh',
            mode: 'debug',
            arch: 'x64',
            toolchain: {},
        },
        changed: [],
    });

    assert.match(text, /target:.*build\.sh/i);
    assert.doesNotMatch(text, /target:.*CMakeLists\.txt/i);
});

test('list env 显示工具链信息', () => {
    const r = json('list env');
    assert.ok(r);
    assert.equal(r.category, 'env');
    assert.ok(r.env, '必须有 env 字段');
    // env 可能包含 qt, vs, jom, make 等
});

// ═══════════════════════════════════════════════════════════════
// 12. 配置持久化测试
// ═════════════════════════════════════════════════════════════

test('server add 后配置持久化', () => {
    const name = `persist-test-${Date.now()}`;

    // 添加
    const addResult = json(`server add --name ${name} --host 9.9.9.9 --username persistuser`);
    assert.ok(addResult.ok);

    // 重新读取
    const listResult = json('server');
    const found = listResult.servers.find((s: { name?: string }) => s.name === name);
    assert.ok(found, 'server 必须持久化');
    assert.equal(found.host, '9.9.9.9');

    // 清理
    run(`server remove ${found.id} --force`);
});

// ═══════════════════════════════════════════════════════════════
// 13. 边界情况测试
// ═════════════════════════════════════════════════════════════

test('空工作区 status 不崩溃', () => {
    const emptyDir = path.join(TEST_DIR, 'empty-ws');
    fs.mkdirSync(emptyDir, { recursive: true });

    const r = run('status', emptyDir);
    // 不应该崩溃（exit code 0 或 1 都可以）
    assert.ok(r.code === 0 || r.code === 1, '空工作区 status 不应崩溃');

    const j = json('status', emptyDir);
    assert.ok(j, '必须返回有效 JSON');
});

test('list 所有分类都不崩溃', () => {
    const categories = ['targets', 'env'];
    for (const cat of categories) {
        const r = run(`list ${cat}`);
        assert.ok(r.code === 0 || r.code === 1, `list ${cat} 不应崩溃`);
    }
});

test('JSON 输出必须可解析', () => {
    const cmds = [
        'status', 'list targets', 'list env',
        'remote', 'server',
    ];
    for (const cmd of cmds) {
        const r = run(`${cmd} --json`);
        let parsed;
        try {
            parsed = JSON.parse(r.out);
        } catch {
            assert.fail(`${cmd} --json 输出不是有效 JSON: ${r.out.slice(0, 200)}`);
        }
        assert.ok(parsed, `${cmd} 必须返回 JSON 对象`);
    }
});

// ═══════════════════════════════════════════════════════════════
// 14. 命令帮助测试
// ═════════════════════════════════════════════════════════════

test('所有命令 --help 格式一致', () => {
    const cmds = ['status', 'init', 'list', 'use', 'server', 'build', 'run', 'stop', 'clean', 'sync'];
    for (const cmd of cmds) {
        const r = run(`${cmd} --help --lang en`);
        assert.equal(r.code, 0, `${cmd} --help 必须成功`);
        assert.match(r.out, /Usage:/, `${cmd} --help 必须包含 Usage:`);
    }
});

test('forja --version 显示版本号', () => {
    const r = run('--version');
    assert.equal(r.code, 0);
    assert.match(r.out, /\d+\.\d+\.\d+/, '必须包含版本号');
});

// ═══════════════════════════════════════════════════════════════
// 15. E2E 边界测试（使用隔离临时工作区）
// ═══════════════════════════════════════════════════════════════

function jsonE2E(args: string) {
    return json(args, TEST_DIR);
}

// ── 15.1 无效的 mode/arch 值 ──

test('use target with invalid mode value', () => {
    const j = jsonE2E('use target --mode invalid-mode');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('use target with invalid arch value', () => {
    const j = jsonE2E('use target --arch invalid-arch');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('use target with empty mode', () => {
    const j = jsonE2E('use target --mode ""');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('use target with empty arch', () => {
    const j = jsonE2E('use target --arch ""');
    assert.ok(j);
    assert.equal(j.ok, false);
});

// ── 15.2 无效的端口值（边界测试）──

test('server add with port 0', () => {
    const j = jsonE2E('server add --name test-port-0 --host 192.168.1.100 --username testuser --port 0');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('server add with port 65536 (above max)', () => {
    const j = jsonE2E('server add --name test-port-max --host 192.168.1.100 --username testuser --port 65536');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('server add with negative port', () => {
    const j = jsonE2E('server add --name test-port-neg --host 192.168.1.100 --username testuser --port -1');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('server add with non-numeric port', () => {
    const j = jsonE2E('server add --name test-port-str --host 192.168.1.100 --username testuser --port abc');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('server add with float port', () => {
    const j = jsonE2E('server add --name test-port-float --host 192.168.1.100 --username testuser --port 22.5');
    assert.ok(j);
    assert.equal(j.ok, false);
});

// ── 15.3 缺少必填参数 ──

test('server add without required name', () => {
    const j = jsonE2E('server add --host 192.168.1.100 --username testuser --port 22');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('server add without required host', () => {
    const j = jsonE2E('server add --name test-no-host --username testuser --port 22');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('server add without required username', () => {
    const j = jsonE2E('server add --name test-no-user --host 192.168.1.100 --port 22');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

// ── 15.4 未知 flag ──

test('status with unknown flag', () => {
    const j = jsonE2E('status --unknown-flag');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('list with unknown flag', () => {
    const j = jsonE2E('list targets --invalid-option');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('use target with unknown flag', () => {
    const j = jsonE2E('use target --nonexistent-option');
    assert.ok(j);
    assert.equal(j.ok, false);
});

// ── 15.5 无效的子命令 ──

test('list with invalid category', () => {
    const j = jsonE2E('list invalid-category');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('use with invalid subcommand', () => {
    const j = jsonE2E('use invalid-subcommand');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('server with invalid subcommand', () => {
    const j = jsonE2E('server invalid-action');
    assert.ok(j);
    assert.equal(j.ok, false);
});

// ── 15.6 无效的 auth-mode 值 ──

test('server add with invalid auth-mode', () => {
    const j = jsonE2E('server add --name test-auth --host 192.168.1.100 --username testuser --port 22 --auth-mode invalid-auth');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('server add with empty auth-mode', () => {
    const j = jsonE2E('server add --name test-auth-empty --host 192.168.1.100 --username testuser --port 22 --auth-mode ""');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('server key auth requires a private key instead of an unused password', () => {
    const j = jsonE2E('server add --name test-key-password --host 192.168.1.100 --username testuser --auth-mode key --password secret');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.match(j.diagnostics?.[0]?.message ?? '', /private-key-path/);
});

test('server password auth must be selected explicitly', () => {
    const j = jsonE2E('server add --name implicit-password --host 192.168.1.100 --username testuser --password secret');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.match(j.diagnostics?.[0]?.message ?? '', /auth-mode password/);
});

test('server default key auth rejects an explicitly blank private key path', () => {
    const j = jsonE2E('server add --name blank-key --host 192.168.1.100 --username testuser --private-key-path "   "');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.match(j.diagnostics?.[0]?.message ?? '', /private-key-path/);
});

test('server update rejects password when selecting key auth', () => {
    const added = jsonE2E('server add --name update-key-auth --host 192.168.1.100 --username testuser --auth-mode password --password secret');
    assert.equal(added.ok, true);

    const updated = jsonE2E(`server update ${added.server.id} --auth-mode key --password secret`);
    assert.equal(updated.ok, false);
    assert.match(updated.diagnostics?.[0]?.message ?? '', /auth-mode password/);

    run(`server remove ${added.server.id} --force`, TEST_DIR);
});

test('server update cannot store a password while remaining in key mode', () => {
    const added = jsonE2E('server add --name update-key-password --host 192.168.1.100 --username testuser --auth-mode key --private-key-path id_rsa');
    assert.equal(added.ok, true);

    const updated = jsonE2E(`server update ${added.server.id} --password secret`);
    assert.equal(updated.ok, false);
    assert.match(updated.diagnostics?.[0]?.message ?? '', /auth-mode password/);

    run(`server remove ${added.server.id} --force`, TEST_DIR);
});

test('server rejects conflicting strict host key flags', () => {
    const j = jsonE2E('server add --name strict-conflict --host 192.168.1.100 --username testuser --strict-host-key-checking --no-strict-host-key-checking');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.match(j.diagnostics?.[0]?.message ?? '', /strict-host-key-checking/);
});

// ── 15.8 空值/空白值 ──

test('server add with whitespace name', () => {
    const j = jsonE2E('server add --name "   " --host 192.168.1.100 --username testuser --port 22');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('server add with whitespace host', () => {
    const j = jsonE2E('server add --name test-ws-host --host "   " --username testuser --port 22');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('server add with whitespace username', () => {
    const j = jsonE2E('server add --name test-ws-user --host 192.168.1.100 --username "   " --port 22');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('server update rejects whitespace required fields', () => {
    const added = jsonE2E('server add --name update-ws --host 192.168.1.100 --username testuser --port 22');
    assert.equal(added.ok, true);

    for (const flag of ['--name', '--host', '--username']) {
        const updated = jsonE2E(`server update ${added.server.id} ${flag} "   "`);
        assert.equal(updated.ok, false);
        assert.equal(updated.serverAction, 'update');
    }

    run(`server remove ${added.server.id} --force`, TEST_DIR);
});

test('server update invalid integer reports update protocol', () => {
    const added = jsonE2E('server add --name update-port --host 192.168.1.100 --username testuser --port 22');
    assert.equal(added.ok, true);

    const updated = jsonE2E(`server update ${added.server.id} --port 22.5`);
    assert.equal(updated.ok, false);
    assert.equal(updated.serverAction, 'update');
    assert.match(updated.nextAction, /^forja server update /);

    run(`server remove ${added.server.id} --force`, TEST_DIR);
});

// ── 15.9 冲突的 flag ──

test('sync with both --dry-run and --yes', () => {
    const j = jsonE2E('sync --dry-run --yes');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

// ── 15.10 无效的项目路径 ──

test('use target with nonexistent project', () => {
    const j = jsonE2E('use target --project /nonexistent/path/to/project.pro');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('use target with empty project path', () => {
    const j = jsonE2E('use target --project ""');
    assert.ok(j);
    assert.equal(j.ok, false);
});

// ── 15.11 无效的工作区路径 ──

test('init with nonexistent workspace', () => {
    const j = jsonE2E('init --workspace /nonexistent/workspace/path');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('init with empty workspace', () => {
    const j = jsonE2E('init --workspace ""');
    assert.ok(j);
    assert.equal(j.ok, false);
});

// ── 15.12 无效的服务器 ID ──

test('server update with nonexistent ID', () => {
    const j = jsonE2E('server update nonexistent-server-id --name new-name');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('server remove with nonexistent ID', () => {
    const j = jsonE2E('server remove nonexistent-server-id --force');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('server update with empty ID', () => {
    const j = jsonE2E('server update "" --name new-name');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('server remove with empty ID', () => {
    const j = jsonE2E('server remove "" --force');
    assert.ok(j);
    assert.equal(j.ok, false);
});

// ── 15.14 无效的文件路径 ──

test('sync with nonexistent file', () => {
    const j = jsonE2E('sync --file /nonexistent/file.txt');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('sync with empty file path', () => {
    const j = jsonE2E('sync --file ""');
    assert.ok(j);
    assert.equal(j.ok, false);
});

// ── 15.15 多个未知 flag ──

test('status with multiple unknown flags', () => {
    const j = jsonE2E('status --unknown1 --unknown2 --unknown3');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('list with multiple unknown flags', () => {
    const j = jsonE2E('list targets --invalid1 --invalid2');
    assert.ok(j);
    assert.equal(j.ok, false);
});

// ── 15.16 混合有效和无效 flag ──

test('use target with valid mode and invalid flag', () => {
    const j = jsonE2E('use target --mode debug --unknown-flag');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('server add with valid params and unknown flag', () => {
    const j = jsonE2E('server add --name test-mixed --host 192.168.1.100 --username testuser --port 22 --invalid-option');
    assert.ok(j);
    assert.equal(j.ok, false);
});

// ── 15.17 无效的远程路径 ──

test('removed remote set is unavailable', () => {
    const j = jsonE2E('remote set --server test-server --remote-path "/srv/test"');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('use target answers file completes missing variant selection', async () => {
    const { runUseTarget } = require('../cli/commands/use');
    const workspace = fs.mkdtempSync(path.join(TEST_DIR, 'use-target-answers-'));
    const answers = path.join(workspace, 'answers.json');
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    fs.writeFileSync(answers, JSON.stringify({ mode: 'release', arch: 'x64' }));

    try {
        const result = await runUseTarget(workspace, {
            project: 'CMakeLists.txt',
            answers,
            interactive: false,
            json: true,
        });
        const questionIds = (result.questions || []).map((question: { id: string }) => question.id);
        assert.equal(questionIds.includes('mode'), false);
        assert.equal(questionIds.includes('arch'), false);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

// ── 15.18 无效的忽略模式 ──

test('sync ignore with empty pattern', () => {
    const j = jsonE2E('sync ignore --add ""');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('sync ignore with whitespace pattern', () => {
    const j = jsonE2E('sync ignore --add "   "');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('sync ignore remove with nonexistent pattern', () => {
    const j = jsonE2E('sync ignore --rm nonexistent-pattern-xyz');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

// ── 15.19 无效的工具链路径 ──

test('use target with nonexistent Qt path', () => {
    const j = jsonE2E('use target --qt /nonexistent/qt/path');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('use target with empty Qt path', () => {
    const j = jsonE2E('use target --qt ""');
    assert.ok(j);
    assert.equal(j.ok, false);
});

test('use target with nonexistent VS path', () => {
    const j = jsonE2E('use target --vs /nonexistent/vs/path');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});

test('use target with empty VS path', () => {
    const j = jsonE2E('use target --vs ""');
    assert.ok(j);
    assert.equal(j.ok, false);
});

// ── 15.20 特殊字符边界情况 ──

test('server add with special characters in name', () => {
    const j = jsonE2E('server add --name "test@server#1" --host 192.168.1.100 --username testuser --port 22');
    assert.ok(j);
    assert.ok(j.ok !== undefined);
});

test('server add with unicode in name', () => {
    const j = jsonE2E('server add --name "测试服务器" --host 192.168.1.100 --username testuser --port 22');
    assert.ok(j);
    assert.ok(j.ok !== undefined);
});

test('use target with special characters in project path', () => {
    const j = jsonE2E('use target --project "test@project#1.pro"');
    assert.ok(j);
    assert.equal(j.ok, false);
    assert.ok(j.diagnostics?.length > 0);
});
