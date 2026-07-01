/**
 * `forja stop` — stop running process for current active target.
 * Output format follows v2 spec: StopResult interface.
 */
import { requireActiveTarget } from './activeTarget';
import { readRunState, clearRunState, resolveRunProcessStatus, isProcessRunning } from '../../qt/shared/localState';
import { executeRemotePlan } from '../../remote/core/plan';
import { ActiveTarget, Diagnostic, RuntimeState, diag, T } from './types';
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

function terminateProcess(pid: number): { ok: boolean; error?: string } {
    if (!Number.isInteger(pid) || pid <= 0) { return { ok: false, error: 'invalid pid' }; }
    try {
        if (process.platform === 'win32') {
            cp.execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
        } else {
            process.kill(pid, 'SIGTERM');
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runStop(workspace: string, options: { json?: boolean } = {}): Promise<StopResult> {
    const targetResult = requireActiveTarget(workspace);

    if ('error' in targetResult) {
        return {
            ok: false,
            action: 'stop',
            workspace,
            state: 'not-running',
            diagnostics: [diag('error', targetResult.error)],
            nextAction: targetResult.nextAction,
        };
    }
    const target = targetResult.target;

    if (target.kind === 'sdk') {
        return {
            ok: false,
            action: 'stop',
            workspace,
            activeTarget: target,
            state: 'unsupported',
            diagnostics: [diag('error', T('stopSdkUnsupported'))],
            nextAction: 'forja status',
        };
    }

    if (target.runAt === 'remote') {
        const remoteResult = await executeRemotePlan({
            workspace,
            target: 'qt',
            action: 'stop',
            json: options.json ?? false,
        });

        return {
            ok: remoteResult.ok,
            action: 'stop',
            workspace,
            activeTarget: target,
            state: remoteResult.ok ? 'stopped' : 'not-running',
            diagnostics: remoteResult.diagnostics.map(d => diag(d.level as Diagnostic['level'], d.message)),
            nextAction: remoteResult.nextAction,
        };
    }

    // Qt local: directly read run state and terminate
    const state = readRunState(workspace);
    const status = resolveRunProcessStatus(state);

    if (!status.running) {
        if (state) { clearRunState(workspace); }
        return {
            ok: true,
            action: 'stop',
            workspace,
            activeTarget: target,
            state: 'not-running',
            diagnostics: [diag('info', T('noRunningProcess'))],
            nextAction: 'forja run',
        };
    }

    const pid = status.pid ?? state?.pid ?? 0;
    const result = terminateProcess(pid);

    if (!result.ok) {
        return {
            ok: false,
            action: 'stop',
            workspace,
            activeTarget: target,
            state: 'running',
            diagnostics: [diag('error', `${T('stopTerminateFailed')} (pid ${pid}): ${result.error}`)],
            nextAction: 'forja doctor',
        };
    }

    // Verify process actually exited (SIGTERM is graceful on POSIX)
    if (process.platform !== 'win32') {
        let stillRunning = true;
        for (let i = 0; i < 10; i++) {
            await delay(200);
            if (!isProcessRunning(pid)) { stillRunning = false; break; }
        }
        if (stillRunning) {
            return {
                ok: false,
                action: 'stop',
                workspace,
                activeTarget: target,
                state: 'running',
                diagnostics: [diag('warning', `${T('stopStillRunning')} (pid ${pid}), SIGTERM ${T('stopTerminateFailed')}`)],
                nextAction: 'forja doctor',
            };
        }
    }

    clearRunState(workspace);
    return {
        ok: true,
        action: 'stop',
        workspace,
        activeTarget: target,
        state: 'stopped',
        runtime: {
            running: false,
            pid,
            executablePath: state?.executablePath,
            logFile: state?.logFile,
            runAt: 'local',
        },
        nextAction: 'forja run',
    };
}

export function outputStopResult(result: StopResult, wantsJson: boolean): void {
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        if (result.state === 'stopped') {
            console.log(`${T('processStopped')} (${T('pidLabel')}: ${result.runtime?.pid ?? 'unknown'})`);
        } else if (result.state === 'not-running') {
            console.log(T('noRunningProcess'));
        } else if (result.state === 'unsupported') {
            console.log(T('stopNotSupported'));
        } else if (result.state === 'running') {
            console.log(`${T('stopStillRunning')} (${T('pidLabel')}: ${result.runtime?.pid ?? '?'})`);
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
