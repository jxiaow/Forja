import { parseCliArgs, isHelpRequest, getHelpText } from './args';
import { CliResult } from './types';
import { createActionPlan } from '../shared/qtCore';
import { runCliResult } from '../shared/commandRunner';
import { executeSyncCli } from '../shared/syncCli';
import { readRunState, isProcessRunning, runLogPath } from '../shared/localState';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Compact JSON output: omit empty/null/default fields to reduce token consumption.
 * Only warning/error diagnostics are included; info-level is conveyed through resolved.
 * When build fails: omit raw stdout/stderr (available via logFile), output errors + warningSummary instead.
 */
function compactResult(result: CliResult): Record<string, unknown> {
    const out: Record<string, unknown> = { ok: result.ok, action: result.action };

    const diagnostics = result.diagnostics.filter(d => d.level !== 'info');
    if (diagnostics.length > 0) { out.diagnostics = diagnostics; }
    if (result.nextActions.length > 0) { out.nextActions = result.nextActions; }
    if (result.exitCode !== null) { out.exitCode = result.exitCode; }
    if (result.errors.length > 0) { out.errors = result.errors; }
    if (result.warningSummary) { out.warningSummary = result.warningSummary; }
    if (result.logFile) { out.logFile = result.logFile; }

    // Successful detach launches: minimal output
    const isDetachSuccess = result.ok && result.logFile && result.exitCode === 0
        && ['run', 'build', 'clean'].includes(result.action);
    if (isDetachSuccess) {
        if (result.resolved) { out.resolved = { mode: result.resolved.mode, arch: result.resolved.arch }; }
        return out;
    }

    if (result.project) {
        out.project = path.relative(result.workspace, result.project) || result.project;
    }
    if (result.commands.length > 0) { out.commands = result.commands; }
    if (result.shellCommand) { out.shellCommand = result.shellCommand; }
    if (result.durationMs > 0) { out.durationMs = result.durationMs; }

    // When build failed: don't dump full stdout/stderr (it's in logFile).
    // Only include stdout/stderr for non-build actions or successful builds.
    const isBuildFailure = !result.ok && result.exitCode !== null && result.exitCode !== 0
        && ['build', 'run', 'clean', 'qmake', 'rcc'].includes(result.action);
    if (!isBuildFailure) {
        if (result.stdout) { out.stdout = result.stdout; }
        if (result.stderr) { out.stderr = result.stderr; }
    } else {
        // For build failures, include only stderr if it's short (jom/make error summary)
        if (result.stderr && result.stderr.length < 500) { out.stderr = result.stderr; }
    }

    if (result.resolved) {
        const r: Record<string, unknown> = {};
        if (result.resolved.mode) { r.mode = result.resolved.mode; }
        if (result.resolved.arch) { r.arch = result.resolved.arch; }
        if (result.resolved.qtPath) { r.qtPath = result.resolved.qtPath; }
        if (result.resolved.vsDevShell) { r.vsDevShell = result.resolved.vsDevShell; }
        if (result.resolved.jomPath) { r.jomPath = result.resolved.jomPath; }
        if (result.resolved.target) { r.target = result.resolved.target; }
        if (result.resolved.qtVersion) { r.qtVersion = result.resolved.qtVersion; }
        if (result.resolved.vsVersion) { r.vsVersion = result.resolved.vsVersion; }
        if (result.resolved.project) { r.project = result.resolved.project; }
        if (Object.keys(r).length > 0) { out.resolved = r; }
    }

    return out;
}

function textOutput(result: CliResult): string {
    const status = result.ok ? '成功' : '失败';
    const lines = [
        `Qt Pilot ${result.action} ${status}`,
        `执行模式: ${result.mode}`,
        `工作区: ${result.workspace}`
    ];
    if (result.project) {
        lines.push(`项目: ${result.project}`);
    }
    if (result.commands.length > 0) {
        lines.push('命令:');
        for (const cmd of result.commands) {
            lines.push(`  ${cmd}`);
        }
    }
    if (result.resolved) {
        lines.push(`构建配置: ${result.resolved.mode} / ${result.resolved.arch}`);
        if (result.resolved.qtPath) {
            lines.push(`Qt: ${result.resolved.qtPath}`);
        }
        if (result.resolved.vsDevShell) {
            lines.push(`VS Dev Shell: ${result.resolved.vsDevShell}`);
        }
    }
    if (result.errors.length > 0) {
        lines.push('错误:');
        for (const err of result.errors) {
            lines.push(`  ${err}`);
        }
    }
    for (const diagnostic of result.diagnostics) {
        if (diagnostic.level === 'info') { continue; }
        lines.push(`${diagnostic.level}: ${diagnostic.message}`);
    }
    if (result.nextActions.length > 0) {
        lines.push('下一步:');
        for (const action of result.nextActions) {
            lines.push(`  ${action}`);
        }
    }
    return lines.join('\n');
}

async function main(argv: string[]): Promise<void> {
    if (isHelpRequest(argv)) {
        console.log(getHelpText());
        return;
    }

    let wantsJson = argv.includes('--json');
    try {
        const options = parseCliArgs(argv);
        wantsJson = options.json;

        const workspace = path.resolve(options.workspace || process.cwd());

        // logs 查看运行日志
        if (options.action === 'logs') {
            const state = readRunState(workspace);
            const logFile = runLogPath(workspace);

            if (!fs.existsSync(logFile)) {
                const msg = '没有运行日志（程序可能未以 --detach 模式启动过）';
                if (wantsJson) { console.log(JSON.stringify({ ok: false, diagnostics: [{ level: 'warning', message: msg }] })); }
                else { console.log(msg); }
                return;
            }

            const content = fs.readFileSync(logFile, 'utf8');
            const lines = content.split(/\r?\n/);
            const tail = lines.slice(-100).join('\n');

            if (wantsJson) {
                const running = state ? isProcessRunning(state.pid) : false;
                console.log(JSON.stringify({
                    ok: true,
                    action: 'logs',
                    pid: state?.pid || null,
                    running,
                    logFile,
                    tail
                }, null, 2));
            } else {
                if (state) {
                    const running = isProcessRunning(state.pid);
                    console.log(`PID: ${state.pid} (${running ? 'running' : 'exited'})`);
                    console.log(`Log: ${logFile}`);
                    console.log('---');
                }
                console.log(tail);
            }
            return;
        }

        // sync 走独立路径
        if (options.action === 'sync') {
            if (options.executionMode === 'dryRun') {
                const output = { ok: true, action: 'sync', mode: 'dryRun', message: '去掉 --plan 执行同步' };
                if (wantsJson) { console.log(JSON.stringify(output, null, 2)); }
                else { console.log('Sync (plan): 去掉 --plan 执行同步'); }
                return;
            }
            const result = await executeSyncCli(workspace, options.server || undefined, options.repo || undefined);
            if (wantsJson) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                if (result.ok) {
                    console.log(`同步完成: ${result.uploaded.length} 个文件已上传`);
                    if (result.skipped.length > 0) { console.log(`跳过: ${result.skipped.length} 个`); }
                } else {
                    console.error(`同步失败: ${result.failed.map(f => f.error).join(', ')}`);
                }
            }
            process.exitCode = result.ok ? 0 : 1;
            return;
        }

        const planned = await createActionPlan(options);

        // env/projects/status/use: custom output structure, bypass compactResult
        if (options.action === 'env' || options.action === 'projects' || options.action === 'status' || options.action === 'use') {
            if (!planned.ok) {
                if (wantsJson) {
                    console.log(JSON.stringify(compactResult(planned), null, 2));
                } else {
                    console.log(textOutput(planned));
                }
                process.exitCode = 1;
                return;
            }
            const customData = planned.data || JSON.parse(planned.stdout);
            if (options.action === 'env') {
                const envOutput = {
                    ok: true,
                    action: 'env',
                    current: {
                        mode: planned.resolved?.mode || 'debug',
                        arch: planned.resolved?.arch || 'x86',
                        qtPath: planned.resolved?.qtPath || null,
                        qtVersion: planned.resolved?.qtVersion || null,
                        vsDevShell: planned.resolved?.vsDevShell || null,
                        vsVersion: planned.resolved?.vsVersion || null,
                        jomPath: planned.resolved?.jomPath || null
                    },
                    ...customData
                };
                if (wantsJson) {
                    console.log(JSON.stringify(envOutput, null, 2));
                } else {
                    console.log(formatEnvText(envOutput));
                }
            } else if (options.action === 'projects') {
                const projectsOutput = {
                    ok: true,
                    action: 'projects',
                    ...customData
                };
                if (wantsJson) {
                    console.log(JSON.stringify(projectsOutput, null, 2));
                } else {
                    console.log(formatProjectsText(projectsOutput));
                }
            } else if (options.action === 'use') {
                const useOutput = {
                    ok: true,
                    action: 'use',
                    ...customData
                };
                if (wantsJson) {
                    console.log(JSON.stringify(useOutput, null, 2));
                } else {
                    console.log(textOutput(planned));
                }
            } else {
                // status — resolved 只包含非空字段，平台无关字段不输出
                const resolvedRaw: Record<string, unknown> = {
                    mode: planned.resolved?.mode || 'debug',
                    arch: planned.resolved?.arch || 'x86'
                };
                if (planned.resolved?.qtPath) { resolvedRaw.qtPath = planned.resolved.qtPath; }
                if (planned.resolved?.qtVersion) { resolvedRaw.qtVersion = planned.resolved.qtVersion; }
                if (planned.resolved?.vsDevShell) { resolvedRaw.vsDevShell = planned.resolved.vsDevShell; }
                if (planned.resolved?.vsVersion) { resolvedRaw.vsVersion = planned.resolved.vsVersion; }
                if (planned.resolved?.jomPath) { resolvedRaw.jomPath = planned.resolved.jomPath; }
                if (planned.resolved?.target) { resolvedRaw.target = planned.resolved.target; }
                if (planned.resolved?.project) { resolvedRaw.project = planned.resolved.project; }
                const statusOutput = {
                    ...customData,
                    resolved: resolvedRaw
                };
                if (wantsJson) {
                    console.log(JSON.stringify(statusOutput, null, 2));
                } else {
                    console.log(formatStatusText(statusOutput));
                }
            }
            return;
        }

        const result = await runCliResult(planned, { streaming: !wantsJson, detach: options.detach });
        if (wantsJson) {
            console.log(JSON.stringify(compactResult(result), null, 2));
        } else {
            console.log(textOutput(result));
        }
        process.exitCode = result.ok ? 0 : 1;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (wantsJson) {
            console.log(JSON.stringify({
                ok: false,
                diagnostics: [{ level: 'error', message }]
            }, null, 2));
        } else {
            console.error(message);
        }
        process.exitCode = 1;
    }
}

function formatStatusText(data: Record<string, unknown>): string {
    const checks = data.checks as Record<string, boolean>;
    const resolved = data.resolved as Record<string, unknown>;
    const ready = data.ready as boolean;
    const lines: string[] = [
        `项目状态: ${ready ? '就绪' : '未就绪'}`,
        ''
    ];

    if (resolved.project) {
        lines.push(`  项目: ${resolved.project}`);
    }
    lines.push(`  模式: ${resolved.mode}/${resolved.arch}`);
    if (resolved.qtPath) {
        lines.push(`  Qt: ${resolved.qtPath}${resolved.qtVersion ? ' (v' + resolved.qtVersion + ')' : ''}`);
    }

    lines.push('');
    lines.push('检查项:');
    for (const [key, ok] of Object.entries(checks)) {
        lines.push(`  ${ok ? '✓' : '✗'} ${key}`);
    }

    lines.push('');
    lines.push(`下一步: compilot qt ${data.nextAction}`);
    const nextActions = data.nextActions as string[] | undefined;
    if (nextActions && nextActions.length > 0) {
        for (const action of nextActions) {
            lines.push(`  ${action}`);
        }
    }

    const diagnostics = data.diagnostics as Array<Record<string, string>> | undefined;
    if (diagnostics && diagnostics.length > 0) {
        lines.push('');
        for (const d of diagnostics) {
            lines.push(`${d.level}: ${d.message}`);
        }
    }

    return lines.join('\n');
}

function formatEnvText(env: Record<string, unknown>): string {
    const current = env.current as Record<string, unknown>;
    const available = env.available as Record<string, unknown>;
    const lines: string[] = ['工具链环境:', ''];
    lines.push(`  mode: ${current.mode}`);
    lines.push(`  arch: ${current.arch}`);
    lines.push(`  Qt: ${current.qtPath || '未检测到'}${current.qtVersion ? ' (v' + current.qtVersion + ')' : ''}`);
    lines.push(`  VS DevShell: ${current.vsDevShell || '未检测到'}${current.vsVersion ? ' (' + current.vsVersion + ')' : ''}`);
    lines.push(`  构建工具: ${current.jomPath || '未检测到'}`);

    const qtList = available.qt as Array<Record<string, string>>;
    if (qtList && qtList.length > 1) {
        lines.push('');
        lines.push(`可用 Qt (${qtList.length}):`);
        for (const qt of qtList) {
            lines.push(`  ${qt.path} (v${qt.version}, ${qt.compiler})`);
        }
    }

    const configHints = env.configHints as Record<string, string>;
    if (configHints) {
        lines.push('');
        lines.push(`修改: ${configHints.usage}`);
    }
    return lines.join('\n');
}

function formatProjectsText(data: Record<string, unknown>): string {
    const current = data.current as string | null;
    const available = data.available as Array<Record<string, unknown>>;
    const lines: string[] = ['项目列表:', ''];
    if (available.length === 0) {
        lines.push('  未检测到 .pro 文件');
    } else {
        for (const proj of available) {
            const marker = proj.path === current ? ' ← 当前' : '';
            lines.push(`  ${proj.path} (target: ${proj.target})${marker}`);
        }
    }
    const configHints = data.configHints as Record<string, string>;
    if (configHints) {
        lines.push('');
        lines.push(`修改: ${configHints.usage}`);
    }
    return lines.join('\n');
}

/**
 * Qt CLI entry point — called by the unified compilot dispatcher.
 */
export async function runQtCli(argv: string[]): Promise<void> {
    await main(argv);
}
