#!/usr/bin/env node
import { parseCliArgs, isHelpRequest, getHelpText } from './args';
import { CliResult } from './types';
import { createActionPlan } from '../shared/qtCore';
import { runCliResult } from '../shared/commandRunner';
import { executeSyncCli } from '../sync/syncCli';
import { readRunState, isProcessRunning, runLogPath } from '../shared/localState';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Compact JSON output: omit empty/null/default fields to reduce token consumption.
 * brief mode: only ok, action, diagnostics, nextActions, logFile, exitCode.
 */
function compactResult(result: CliResult, brief?: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = { ok: result.ok, action: result.action };

    if (brief) {
        if (result.diagnostics.length > 0) { out.diagnostics = result.diagnostics; }
        if (result.nextActions.length > 0) { out.nextActions = result.nextActions; }
        if (result.exitCode !== null) { out.exitCode = result.exitCode; }
        if (result.errors.length > 0) { out.errors = result.errors; }
        if (result.logFile) { out.logFile = result.logFile; }
        if (result.candidates.length > 0) {
            out.candidates = result.candidates.map(c => path.relative(result.workspace, c) || c);
        }
        return out;
    }

    if (result.mode !== 'dryRun') { out.mode = result.mode; }
    if (result.project) {
        out.project = path.relative(result.workspace, result.project) || result.project;
    }
    if (result.commands.length > 0) { out.commands = result.commands; }
    if (result.shellCommand) { out.shellCommand = result.shellCommand; }
    if (result.candidates.length > 0) {
        out.candidates = result.candidates.map(c => path.relative(result.workspace, c) || c);
    }
    if (result.diagnostics.length > 0) { out.diagnostics = result.diagnostics; }
    if (result.nextActions.length > 0) { out.nextActions = result.nextActions; }
    if (result.exitCode !== null) { out.exitCode = result.exitCode; }
    if (result.durationMs > 0) { out.durationMs = result.durationMs; }
    if (result.errors.length > 0) { out.errors = result.errors; }
    if (result.stdout) { out.stdout = result.stdout; }
    if (result.stderr) { out.stderr = result.stderr; }
    if (result.logFile) { out.logFile = result.logFile; }
    if (!result.ok && result.resolved) { out.resolved = result.resolved; }

    return out;
}

function textOutput(result: CliResult): string {
    const status = result.ok ? '成功' : '失败';
    const lines = [
        `Qt Pilot ${result.action} ${status}`,
        `模式: ${result.mode}`,
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
    if (result.candidates.length > 0) {
        lines.push('候选项目:');
        for (const candidate of result.candidates) {
            lines.push(`  ${candidate}`);
        }
    }
    for (const diagnostic of result.diagnostics) {
        lines.push(`${diagnostic.level}: ${diagnostic.message}`);
        if (diagnostic.hint) {
            lines.push(`hint: ${diagnostic.hint}`);
        }
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

        // logs 查看运行日志
        if (options.action === 'logs') {
            const workspace = path.resolve(options.workspace || process.cwd());
            const state = readRunState(workspace);
            const logFile = runLogPath(workspace);

            if (!fs.existsSync(logFile)) {
                const msg = '没有运行日志（程序可能未以 --detach 模式启动过）';
                if (wantsJson) { console.log(JSON.stringify({ ok: false, diagnostics: [{ level: 'info', message: msg }] })); }
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
            const workspace = options.workspace || process.cwd();
            if (options.executionMode === 'dryRun') {
                const output = { ok: true, action: 'sync', mode: 'dryRun', message: '使用 --execute 执行同步' };
                if (wantsJson) { console.log(JSON.stringify(output, null, 2)); }
                else { console.log('Sync (dry-run): 使用 --execute 执行同步'); }
                return;
            }
            const result = await executeSyncCli(workspace, options.server || undefined);
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
        const result = await runCliResult(planned, { streaming: !wantsJson, detach: options.detach });
        if (wantsJson) {
            console.log(JSON.stringify(compactResult(result, options.brief), null, 2));
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

void main(process.argv.slice(2));
