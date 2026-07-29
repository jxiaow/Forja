import { RemoteBridgeAction, RemoteBridgeTarget } from './bridge';
import { remoteCommand } from './shell';
import { RemoteDiagnostic, RemoteRunner } from './types';

export interface ExecuteRemoteShellFallbackOptions {
    target: RemoteBridgeTarget;
    action: RemoteBridgeAction;
    args?: string[];
    remotePath: string;
    runner: RemoteRunner;
    timeoutMs?: number;
}

export interface ExecuteRemoteShellFallbackResult {
    ok: boolean;
    action: 'bridge';
    mode: 'remote';
    target: RemoteBridgeTarget;
    remoteAction: RemoteBridgeAction;
    remoteCommand: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    result?: unknown;
    diagnostics: RemoteDiagnostic[];
    nextActions: string[];
    fallback: 'shell';
}

export function supportsRemoteShellFallback(target: RemoteBridgeTarget, action: RemoteBridgeAction): boolean {
    if (target === 'qt') {
        return action === 'qmake' || action === 'build' || action === 'clean' || action === 'run' || action === 'stop' || action === 'ps';
    }
    return action === 'build' || action === 'rebuild' || action === 'clean';
}

export async function executeRemoteShellFallback(options: ExecuteRemoteShellFallbackOptions): Promise<ExecuteRemoteShellFallbackResult> {
    const command = buildRemoteShellFallbackCommand(options.target, options.action, options.remotePath, options.args || []);
    const timeoutMs = options.timeoutMs ?? 120000;
    const executed = await options.runner.run(command, timeoutMs);
    const diagnostics: RemoteDiagnostic[] = [];
    let parsed: unknown;
    if (executed.stdout.trim()) {
        try {
            parsed = JSON.parse(executed.stdout);
        } catch {
            parsed = undefined;
        }
    }
    if (executed.exitCode !== 0) {
        diagnostics.push({ level: 'error', message: trim(executed.stderr) || `远端 shell fallback ${options.target} ${options.action} 执行失败` });
    }
    return {
        ok: executed.exitCode === 0,
        action: 'bridge',
        mode: 'remote',
        target: options.target,
        remoteAction: options.action,
        remoteCommand: command,
        exitCode: executed.exitCode,
        stdout: executed.stdout,
        stderr: executed.stderr,
        result: parsed,
        diagnostics,
        nextActions: executed.exitCode === 0 ? [] : [`forja remote ${options.target} status --json`, '检查远端 qmake/make/Makefile'],
        fallback: 'shell'
    };
}

function buildRemoteShellFallbackCommand(target: RemoteBridgeTarget, action: RemoteBridgeAction, remotePath: string, args: string[]): string {
    if (!supportsRemoteShellFallback(target, action)) {
        return 'printf %s ' + remoteCommand([`${target} ${action} 不支持 shell fallback`]) + ' >&2; exit 64';
    }
    const body = target === 'qt' ? buildQtCommand(action, args) : buildSdkCommand(action);
    return `cd ${remoteCommand([remotePath])} && ${body}`;
}

function buildQtCommand(action: RemoteBridgeAction, args: string[]): string {
    const qtPath = readFlagValue(args, '--qt-path');
    const envPrefix = qtPath ? qtEnvPrefix(qtPath) : '';
    if (action === 'ps') {
        return buildQtPsCommand();
    }
    if (action === 'stop') {
        return buildQtStopCommand();
    }
    if (action === 'qmake') {
        const project = readFlagValue(args, '--project');
        const qmakeArgs = readFlagValues(args, '--qmake-args');
        const qmakeBin = qtPath ? remoteCommand([trimSlash(qtPath) + '/bin/qmake']) : 'qmake';
        if (project) {
            return envPrefix + [
                'project=' + remoteCommand([project]),
                'project_dir=$(dirname "$project")',
                'project_file=$(basename "$project")',
                'cd "$project_dir"',
                qmakeBin + ' "$project_file" -spec linux-g++' + formatQmakeArgs(qmakeArgs)
            ].join('; ');
        }
        return envPrefix + [
            'project=$(find . -maxdepth 4 -name "*.pro" | head -n 1)',
            'if [ -z "$project" ]; then printf "未找到 .pro 项目文件\\n" >&2; exit 3; fi',
            'project_dir=$(dirname "$project")',
            'project_file=$(basename "$project")',
            'cd "$project_dir"',
            qmakeBin + ' "$project_file" -spec linux-g++' + formatQmakeArgs(qmakeArgs)
        ].join('; ');
    }
    const makeDir = [
        'makefile=$(find . -maxdepth 4 \\( -name Makefile -o -name makefile -o -name GNUmakefile \\) | head -n 1)',
        'if [ -z "$makefile" ]; then printf "未找到 Makefile，请先运行 qmake\\n" >&2; exit 3; fi',
        'cd "$(dirname "$makefile")"'
    ].join('; ');
    if (action === 'clean') {
        return envPrefix + makeDir + '; make clean';
    }
    if (action === 'run') {
        return envPrefix + [
            makeDir,
            'make -j$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)',
            'exe=$(find . -maxdepth 4 -type f -perm -111 ! -path "*/.git/*" -printf "%T@ %p\\n" 2>/dev/null | sort -nr | head -n 1 | cut -d" " -f2-)',
            'if [ -z "$exe" ]; then printf "未找到可执行文件\\n" >&2; exit 4; fi',
            'state_dir="$OLDPWD/.forja"',
            'mkdir -p "$state_dir"',
            'state_file="$state_dir/run-state"',
            'log_file="$state_dir/run.log"',
            'if [ -f "$state_file" ]; then old_pid=$(sed -n "s/^pid=//p" "$state_file" | head -n 1); if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then kill "$old_pid" 2>/dev/null || true; fi; fi',
            'nohup "$exe" > "$log_file" 2>&1 &',
            'pid=$!',
            'printf "pid=%s\\nexecutable=%s\\nlog=%s\\n" "$pid" "$(pwd -P)/${exe#./}" "$log_file" > "$state_file"',
            'printf "{\\"ok\\":true,\\"action\\":\\"run\\",\\"pid\\":%s,\\"logFile\\":\\"%s\\",\\"executablePath\\":\\"%s\\"}\\n" "$pid" "$log_file" "$(pwd -P)/${exe#./}"'
        ].join('; ');
    }
    return envPrefix + makeDir + '; make -j$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)';
}

function qtEnvPrefix(qtPath: string): string {
    const root = trimSlash(qtPath);
    return 'export PATH=' + remoteCommand([root + '/bin']) + ':"$PATH"; '
        + 'export LD_LIBRARY_PATH=' + remoteCommand([root + '/lib']) + ':"$HOME/.forja/compat/icu55/lib":"$LD_LIBRARY_PATH"; ';
}

function readFlagValue(args: string[], flag: string): string {
    const values = readFlagValues(args, flag);
    return values[values.length - 1] || '';
}

function readFlagValues(args: string[], flag: string): string[] {
    const values: string[] = [];
    for (let i = 0; i < args.length; i++) {
        const item = args[i];
        if (item === flag && args[i + 1]) {
            values.push(args[i + 1]);
            i++;
        } else if (item.startsWith(flag + '=')) {
            values.push(item.slice(flag.length + 1));
        }
    }
    return values;
}

function formatQmakeArgs(args: string[]): string {
    return args.length > 0 ? ' ' + remoteCommand(args) : '';
}

function trimSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

function buildQtPsCommand(): string {
    return [
        'state_file=".forja/run-state"',
        'if [ ! -f "$state_file" ]; then printf "{\\"ok\\":true,\\"action\\":\\"ps\\",\\"running\\":false,\\"pid\\":null,\\"logFile\\":null,\\"executablePath\\":null}\\n"; exit 0; fi',
        'pid=$(sed -n "s/^pid=//p" "$state_file" | head -n 1)',
        'exe=$(sed -n "s/^executable=//p" "$state_file" | head -n 1)',
        'log=$(sed -n "s/^log=//p" "$state_file" | head -n 1)',
        'running=false',
        'if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then running=true; fi',
        'json_pid=null',
        'if [ "$running" = true ]; then json_pid=$pid; fi',
        'printf "{\\"ok\\":true,\\"action\\":\\"ps\\",\\"running\\":%s,\\"pid\\":%s,\\"logFile\\":\\"%s\\",\\"executablePath\\":\\"%s\\"}\\n" "$running" "$json_pid" "$log" "$exe"'
    ].join('; ');
}

function buildQtStopCommand(): string {
    return [
        'state_file=".forja/run-state"',
        'if [ ! -f "$state_file" ]; then printf "{\\"ok\\":true,\\"action\\":\\"stop\\",\\"stopped\\":false,\\"pid\\":null}\\n"; exit 0; fi',
        'pid=$(sed -n "s/^pid=//p" "$state_file" | head -n 1)',
        'stopped=false',
        'if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; stopped=true; fi',
        'rm -f "$state_file"',
        'json_pid=null',
        'if [ -n "$pid" ]; then json_pid=$pid; fi',
        'printf "{\\"ok\\":true,\\"action\\":\\"stop\\",\\"stopped\\":%s,\\"pid\\":%s}\\n" "$stopped" "$json_pid"'
    ].join('; ');
}

function buildSdkCommand(action: RemoteBridgeAction): string {
    const makeDir = [
        'makefile=$(find . -maxdepth 4 \\( -name Makefile -o -name makefile -o -name GNUmakefile \\) | head -n 1)',
        'if [ -z "$makefile" ]; then printf "未找到 Makefile\\n" >&2; exit 3; fi',
        'cd "$(dirname "$makefile")"'
    ].join('; ');
    if (action === 'clean') {
        return makeDir + '; make clean';
    }
    if (action === 'rebuild') {
        return makeDir + '; make clean && make -j$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)';
    }
    return makeDir + '; make -j$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)';
}

function trim(value: string): string {
    return value.trim().split(/\r?\n/).slice(0, 3).join('\n');
}
