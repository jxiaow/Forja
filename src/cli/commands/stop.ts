/**
 * `forja stop` — stop running process for current active target.
 * Output format follows v2 spec: StopResult interface.
 */
import { requireActiveTarget } from './activeTarget';
import { readRunState, clearRunState, resolveRunProcessStatus } from '../../qt/shared/localState';
import { executeRemotePlan } from '../../remote/core/plan';
import { ActiveTarget, Diagnostic, RuntimeState, diag, Locale, T } from './types';
import * as cp from 'child_process';

export interface StopResult {
    ok: boolean;
    action: 'stop';
    workspace?: string;
    activeTarget?: ActiveTarget;
    state: 'stopped' | 'not-running' | 'unsupported' | 'running';
    runtime?: RuntimeState;
    diagnostics?: Diagnostic[];
    nextAction?: string;
}

function terminateProcess(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) { return false; }
    try {
        if (process.platform === 'win32') {
            cp.execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', windowsHide: true });
        } else {
            process.kill(pid, 'SIGTERM');
        }
        return true;
    } catch {
        return false;
    }
}

export async function runStop(workspace: string, options: { json?: boolean; locale?: Locale } = {}): Promise<void> {
    const wantsJson = options.json ?? process.argv.includes('--json');
    const locale: Locale = options.locale ?? 'en';
    const targetResult = requireActiveTarget(workspace);

    if ('error' in targetResult) {
        const result: StopResult = {
            ok: false,
            action: 'stop',
            workspace,
            state: 'not-running',
            diagnostics: [diag('error', targetResult.error)],
            nextAction: targetResult.nextAction,
        };
        outputStopResult(result, wantsJson, locale);
        process.exitCode = 1;
        return;
    }
    const target = targetResult.target;

    if (target.kind === 'sdk') {
        const result: StopResult = {
            ok: false,
            action: 'stop',
            workspace,
            activeTarget: target,
            state: 'unsupported',
            diagnostics: [diag('error', 'SDK target does not support stop')],
            nextAction: 'forja status',
        };
        outputStopResult(result, wantsJson, locale);
        process.exitCode = 1;
        return;
    }

    if (target.runAt === 'remote') {
        const remoteResult = await executeRemotePlan({
            workspace,
            target: 'qt',
            action: 'stop',
            json: wantsJson,
        });

        const result: StopResult = {
            ok: remoteResult.ok,
            action: 'stop',
            workspace,
            activeTarget: target,
            state: remoteResult.ok ? 'stopped' : 'not-running',
            diagnostics: remoteResult.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
            nextAction: remoteResult.nextAction,
        };
        outputStopResult(result, wantsJson, locale);
        process.exitCode = remoteResult.ok ? 0 : 1;
        return;
    }

    // Qt local: directly read run state and terminate
    const state = readRunState(workspace);
    const status = resolveRunProcessStatus(state);

    if (!status.running || !state) {
        const result: StopResult = {
            ok: true,
            action: 'stop',
            workspace,
            activeTarget: target,
            state: 'not-running',
            diagnostics: [diag('info', 'No running process')],
            nextAction: 'forja run',
        };
        outputStopResult(result, wantsJson, locale);
        return;
    }

    const terminated = state.pid ? terminateProcess(state.pid) : false;

    if (terminated) {
        clearRunState(workspace);
        const result: StopResult = {
            ok: true,
            action: 'stop',
            workspace,
            activeTarget: target,
            state: 'stopped',
            runtime: {
                running: false,
                pid: state.pid,
                executablePath: state.executablePath,
                logFile: state.logFile,
                runAt: 'local',
            },
            nextAction: 'forja run',
        };
        outputStopResult(result, wantsJson, locale);
    } else {
        const result: StopResult = {
            ok: false,
            action: 'stop',
            workspace,
            activeTarget: target,
            state: 'running',
            diagnostics: [diag('error', `Failed to terminate process (pid ${state.pid}). It may still be running.`)],
            nextAction: 'forja doctor',
        };
        outputStopResult(result, wantsJson, locale);
        process.exitCode = 1;
    }
}

import { stripJson } from './index';

function outputStopResult(result: StopResult, wantsJson: boolean, locale: Locale): void {
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        if (result.state === 'stopped') {
            console.log(`${T('processStopped')} (${T('pidLabel')}: ${result.runtime?.pid ?? 'unknown'})`);
        } else if (result.state === 'not-running') {
            console.log(T('noRunningProcess'));
        } else if (result.state === 'unsupported') {
            console.log(T('stopNotSupported'));
        }
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                if (d.level !== 'info') {
                    console.log(`${T(d.level)}: ${d.message}`);
                }
            }
        }
        if (result.nextAction) {
            console.log(T('next'));
            console.log(`  ${result.nextAction}`);
        }
    }
}
