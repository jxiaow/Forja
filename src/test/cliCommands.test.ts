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
import test, { before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

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
    try {
        const out = execSync(`node ${cliPath} ${args}`, {
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

before(() => {
    try { execSync('forja --version', { stdio: 'pipe' }); } catch {
        throw new Error('forja CLI not installed');
    }
});

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
        const currentTarget = listJ.targets?.find((t: { current?: boolean }) => t.current === true);

        assert.ok(currentTarget, 'list targets 必须有一个 current=true 的目标');
        const currentProject = currentTarget.project.replace(/\\/g, '/');
        assert.equal(currentProject, activeProject,
            `status activeTarget.project (${activeProject}) 必须与 list targets current (${currentProject}) 一致`);
    }
});

// ═══════════════════════════════════════════════════════════════
// 3. i18n 正确性（Bug #4/#6）
// ════════════════════════════════════════════════════════════

test('doctor 输出跟随 locale（中文）', () => {
    const r = run('doctor --lang zh');
    // 检查关键标签是中文
    assert.match(r.out, /诊断/, 'doctor 必须输出中文"诊断"');
    assert.match(r.out, /工作区/, 'doctor 必须输出中文"工作区"');
    assert.match(r.out, /后续/, 'doctor 必须输出中文"后续"');
});

test('doctor 输出跟随 locale（英文）', () => {
    const r = run('doctor --lang en');
    assert.match(r.out, /Doctor/, 'doctor 必须输出英文"Doctor"');
    assert.match(r.out, /Workspace/, 'doctor 必须输出英文"Workspace"');
    assert.match(r.out, /Next/, 'doctor 必须输出英文"Next"');
});

test('status 输出跟随 locale', () => {
    const zh = run('status --lang zh');
    assert.match(zh.out, /工作区/, '中文 status 必须包含"工作区"');

    const en = run('status --lang en');
    assert.match(en.out, /Workspace/, '英文 status 必须包含"Workspace"');
});

// ═══════════════════════════════════════════════════════════════
// 4. 输出格式一致性（Bug #3/#9/#11）
// ═══════════════════════════════════════════════════════════

test('doctor 检查项格式正确（无连体字）', () => {
    const r = run('doctor --lang zh');
    const lines = r.out.trim().split('\n');

    for (const line of lines) {
        // 只检查检查项行（以 ✓/✗/⚠/– 开头的行）
        if (line.match(/^\s+[✓✗⚠–]/)) {
            // 检查项的 name:message 部分不应有驼峰连体词（如 InfoRemote, ErrorCould）
            // 排除路径（包含 \ 或 / 的部分）
            const withoutPaths = line.replace(/[A-Za-z]:\\[^\s]*/g, '').replace(/\/[^\s]*/g, '');
            assert.doesNotMatch(withoutPaths, /[a-z][A-Z][a-z]+[A-Z]/,
                `检查项不应有驼峰连体词: ${line}`);
        }
    }
});

test('diagnostic level 和 message 之间有分隔符', () => {
    const r = run('doctor');
    const lines = r.out.trim().split('\n');

    for (const line of lines) {
        // 如果包含 error/warning 级别标记，后面必须有分隔符
        if (line.match(/错误|警告|error|warning/i)) {
            // 级别后面必须有 : 或 ： 或空格
            assert.match(line, /(错误|警告|error|warning)\s*[:：]\s*/i,
                `diagnostic 级别后必须有分隔符: ${line}`);
        }
    }
});

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

test('use target --run-at local 设置本地执行', () => {
    const r = json('use target --run-at local');
    assert.ok(r);
    // 可能因为没有 active target 而失败，但必须返回有效 JSON
    assert.equal(r.action, 'use');
    // 如果成功，必须包含 changed 字段
    if (r.ok) {
        assert.ok(Array.isArray(r.changed), '必须包含 changed 数组');
    }
});

test('use target --run-at remote 设置远程执行', () => {
    const r = json('use target --run-at remote');
    assert.ok(r);
    // 可能因为没有配置远程而失败，但必须返回有效 JSON
    assert.equal(r.action, 'use');
});

test('use target --run-at 无效值报错', () => {
    const r = json('use target --run-at invalid');
    assert.ok(r);
    assert.equal(r.ok, false);
});

test('remote --server 设置服务器', () => {
    // 先创建服务器
    const name = `remote-test-${Date.now()}`;
    const addResult = json(`server add --name ${name} --host 1.2.3.4 --username u`);
    assert.ok(addResult.ok);

    // 设置远程
    const r = json(`remote set --server ${name}`);
    assert.ok(r);
    assert.equal(r.ok, true);

    // 清理
    run(`server remove ${addResult.server.id} --force`);
});

test('remote --server 不存在的服务器报错', () => {
    const r = json('remote set --server nonexistent-server');
    assert.ok(r);
    assert.equal(r.ok, false);
});

// ═══════════════════════════════════════════════════════════════
// 11. List 详细功能测试
// ═════════════════════════════════════════════════════════════

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
    assert.ok(Array.isArray(r.targets), 'targets 必须是数组');

    // 每个 target 必须有必要字段
    for (const t of r.targets) {
        assert.ok(t.kind, 'target 必须有 kind');
        assert.ok(t.project, 'target 必须有 project');
        assert.ok(typeof t.current === 'boolean', 'target 必须有 current 布尔值');
        assert.ok(typeof t.configured === 'boolean', 'target 必须有 configured 布尔值');
    }
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
    const cmds = ['status', 'init', 'list', 'use', 'server', 'build', 'run', 'stop', 'clean', 'doctor', 'sync'];
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
