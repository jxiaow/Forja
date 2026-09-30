/**
 * CLI entry — dispatches to 11 top-level commands.
 * Called by src/cli/index.ts.
 * Handler implementations live in the matching command module;
 * shared arg helpers in args.ts, result output in output.ts, remote-mode routing in remoteMode.ts.
 */
import { T, resolveLocale, setGlobalLocale } from './types';
import { extractWorkspace, suggestCorrection } from './args';
import { outputResult } from './output';
import { handleStatus } from './status';
import { handleList } from './list';
import { handleUse } from './use';
import { handleRemote } from './remote';
import { handleServer } from './server';
import { handleBuild } from './build';
import { handleRun } from './run';
import { handleStop } from './stop';
import { handleClean } from './clean';
import { handleSync } from './sync';
import { handleDeploy } from './deploy';
import { handleInit } from './init';
import { loadGlobalConfig } from '../../core/settingsIO';
import { resolveWorkroot } from '../../core/workspaceStore';

type Command = 'status' | 'list' | 'use' | 'remote' | 'server' | 'build' | 'run' | 'stop' | 'clean' | 'sync' | 'deploy' | 'init';

const COMMANDS: Command[] = ['status', 'list', 'use', 'remote', 'server', 'build', 'run', 'stop', 'clean', 'sync', 'deploy', 'init'];

export function isCommand(cmd: string): cmd is Command {
    return COMMANDS.includes(cmd as Command);
}

function getTopLevelHelp(): string { return T('help.toplevel'); }

function getCommandHelp(cmd: string): string {
    const map: Record<string, string> = {
        status: T('help.status'),
        list: T('help.list'),
        use: T('help.use'),
        remote: T('help.remote'),
        server: T('help.server.full'),
        build: T('help.build'),
        run: T('help.run'),
        stop: T('help.stop'),
        clean: T('help.clean'),
        sync: T('help.sync.actual'),
        deploy: T('help.deploy'),
        init: T('help.init'),
    };
    return map[cmd] || '';
}

export async function runCli(argv: string[]): Promise<void> {
    const wantsJson = argv.includes('--json');
    const wsResult = extractWorkspace(argv);
    const cwd = wsResult.cwd;
    const workspaceError = wsResult.error ?? null;
    // Resolve workroot once at entry — all commands receive the registered workroot (or cwd if not registered)
    const workroot = resolveWorkroot(cwd) || cwd;
    const globalConfig = loadGlobalConfig();
    const langIdx = argv.indexOf('--lang');
    let langValue: string | undefined;
    let langError: string | null = null;
    if (langIdx >= 0) {
        const next = argv[langIdx + 1];
        if (!next || next.startsWith('--')) {
            langError = T('langRequiresValue');
        } else if (next !== 'zh' && next !== 'en') {
            langError = `${T('use.invalidLanguage')}: ${next}. ${T('use.useZhOrEn')}`;
        } else {
            langValue = next;
        }
    }
    const locale = resolveLocale(langValue, globalConfig.lang);
    setGlobalLocale(locale);

    // Report --workspace / --lang value errors before any command execution
    if (workspaceError || langError) {
        const msg = [workspaceError, langError].filter(Boolean).join('\n');
        if (wantsJson) {
            outputResult({ ok: false, action: 'cli', diagnostics: [{ level: 'error', message: msg }] }, wantsJson);
        } else {
            console.error(msg);
        }
        process.exitCode = 1;
        return;
    }

    // Intercept --help / -h before any other check (including no-command)
    if (argv.includes('--help') || argv.includes('-h')) {
        const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
        const helpText = cmd ? (getCommandHelp(cmd) || T('unknownCommand', [cmd])) : getTopLevelHelp();
        if (wantsJson) {
            outputResult({ ok: true, action: cmd || 'help', diagnostics: [{ level: 'info', message: helpText }] }, wantsJson);
        } else {
            console.log(helpText);
        }
        return;
    }

    // Command-first: argv[0] must be the command, flags follow after
    if (argv.length === 0 || argv[0].startsWith('--')) {
        if (wantsJson) {
            outputResult({ ok: false, action: 'cli', diagnostics: [{ level: 'error', message: T('idx.noCommand') }] }, wantsJson);
        } else {
            console.error(T('idx.noCommand'));
        }
        process.exitCode = 1;
        return;
    }

    const commandIdx = 0;
    const command = argv[commandIdx] as Command;

    switch (command) {
        case 'status':
            return handleStatus(argv, workroot, wantsJson, locale);
        case 'list':
            return handleList(argv, workroot, wantsJson, locale);
        case 'use':
            return handleUse(argv, workroot, wantsJson, locale);
        case 'remote':
            return handleRemote(argv, workroot, wantsJson, locale);
        case 'server':
            return handleServer(argv, workroot, wantsJson, locale);
        case 'build':
            return handleBuild(argv, workroot, wantsJson, locale);
        case 'run':
            return handleRun(argv, workroot, wantsJson, locale);
        case 'stop':
            return handleStop(argv, workroot, wantsJson, locale);
        case 'clean':
            return handleClean(argv, workroot, wantsJson, locale);
        case 'sync':
            return handleSync(argv, workroot, wantsJson, locale);
        case 'deploy':
            return handleDeploy(argv, workroot, wantsJson, locale);
        case 'init':
            return handleInit(argv, cwd, wantsJson, locale);
        default: {
            const KNOWN_COMMANDS = ['status', 'list', 'use', 'remote', 'server', 'build', 'run', 'stop', 'clean', 'sync', 'deploy', 'init'];
            const suggestion = suggestCorrection(command, KNOWN_COMMANDS);
            const msg = suggestion
                ? `${T('idx.unknownCommand')}: ${command}. ${T('idx.didYouMean')}: forja ${suggestion}?`
                : `${T('idx.unknownCommand')}: ${command}`;
            if (wantsJson) {
                outputResult({ ok: false, action: command, diagnostics: [{ level: 'error', message: msg }], nextAction: suggestion ? `forja ${suggestion}` : 'forja --help' }, wantsJson);
            } else {
                console.error(msg);
            }
            process.exitCode = 1;
        }
    }
}
