/**
 * CLI entry — dispatches to 11 top-level commands.
 * Called by src/cli/index.ts.
 */
import * as path from 'path';
import { ForjaJsonResult } from './types';
import { runStatus, formatStatusText } from './status';
import { runSetup, formatSetupText } from './setup';
import { runList, ListCategory, EnvSubCategory, formatListText } from './list';
import { runUseTarget, runUseExecution, runUseRemote, runUseRemoteWorkspace, runUseRemoteRepo, runUseRemoteForjaBin, runUseRemoteBuildOrder, runUseRemoteTransfer, runUseQt, runUseSdk, runUseLang, formatUseText } from './use';
import { runServerAdd, runServerUpdate, runServerRemove, formatServerText } from './server';
import { runBuild, BuildAction, outputBuildResult } from './build';
import { runRun, outputRunResult } from './run';
import { runStop, outputStopResult } from './stop';
import { runClean, outputCleanResult } from './clean';
import { runDoctor, formatDoctorText } from './doctor';
import { runSyncPlan, runSyncExecute, runSyncReset, runSyncStatus, formatSyncText } from './sync';
import { confirm, prompt, choose } from './prompt';
import { resolveLocale, Locale, T, setGlobalLocale } from './types';
import { loadGlobalConfig } from '../../core/settingsIO';
import { readServers, addServer, resolveServerSelector, readProjectSyncConfig } from '../../core/serverStore';
import { resolveGitRoots } from '../../core/gitRepoResolver';
import { configureSyncSettings, ClassifiedChanges } from '../../sync/cli';

type Command = 'status' | 'setup' | 'list' | 'use' | 'server' | 'build' | 'run' | 'stop' | 'clean' | 'doctor' | 'sync';

const COMMANDS: Command[] = ['status', 'setup', 'list', 'use', 'server', 'build', 'run', 'stop', 'clean', 'doctor', 'sync'];

export function isCommand(cmd: string): cmd is Command {
    return COMMANDS.includes(cmd as Command);
}

// Track --workspace value errors
let workspaceError: string | null = null;

function getTopLevelHelp(): string { return T('help.toplevel'); }

function getCommandHelp(cmd: string): string {
    const map: Record<string, string> = {
        status: T('help.status'),
        setup: T('help.setup'),
        list: T('help.list'),
        use: T('help.use'),
        server: T('help.server.full'),
        build: T('help.build'),
        run: T('help.run'),
        stop: T('help.stop'),
        clean: T('help.clean'),
        doctor: T('help.doctor'),
        sync: T('help.sync.actual'),
    };
    return map[cmd] || '';
}

export async function runCli(argv: string[]): Promise<void> {
    const wantsJson = argv.includes('--json');
    const workspace = extractWorkspace(argv);
    const globalConfig = loadGlobalConfig();
    const locale = resolveLocale(extractFlag(argv, '--lang'), globalConfig.lang);
    setGlobalLocale(locale);

    // Report --workspace value error before any command execution
    if (workspaceError) {
        const msg = workspaceError;
        workspaceError = null;
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
        const helpText = cmd ? (getCommandHelp(cmd) || `Unknown command: ${cmd}`) : getTopLevelHelp();
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
            return handleStatus(argv, workspace, wantsJson, locale);
        case 'setup':
            return handleSetup(argv, workspace, wantsJson, locale);
        case 'list':
            return handleList(argv, workspace, wantsJson, locale);
        case 'use':
            return handleUse(argv, workspace, wantsJson, locale);
        case 'server':
            return handleServer(argv, workspace, wantsJson, locale);
        case 'build':
            return handleBuild(argv, workspace, wantsJson, locale);
        case 'run':
            return handleRun(argv, workspace, wantsJson, locale);
        case 'stop':
            return handleStop(argv, workspace, wantsJson, locale);
        case 'clean':
            return handleClean(argv, workspace, wantsJson, locale);
        case 'doctor':
            return handleDoctor(argv, workspace, wantsJson, locale);
        case 'sync':
            return handleSync(argv, workspace, wantsJson, locale);
        default: {
            const KNOWN_COMMANDS = ['status', 'setup', 'list', 'use', 'server', 'build', 'run', 'stop', 'clean', 'doctor', 'sync'];
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

// ── Argument helpers ──

function extractWorkspace(argv: string[]): string {
    const idx = argv.indexOf('--workspace');
    if (idx >= 0) {
        const next = argv[idx + 1];
        if (!next || next.startsWith('--')) {
            workspaceError = '--workspace requires a value. Usage: forja <command> --workspace <path>';
            return process.cwd();
        }
        return path.resolve(next);
    }
    return process.cwd();
}

function extractFlag(argv: string[], flag: string): string | undefined {
    const idx = argv.indexOf(flag);
    if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) {
        return argv[idx + 1];
    }
    return undefined;
}

function hasFlag(argv: string[], flag: string): boolean {
    return argv.includes(flag);
}

// Known global flags that are valid for any command
const GLOBAL_FLAGS = new Set(['--json', '--workspace', '--lang', '--help', '-h']);

/**
 * Suggest a correction when user input doesn't match any valid option.
 * Uses substring matching: if the input contains a keyword that appears in a valid option,
 * or a valid option contains the input as a substring, return the best match.
 */
function suggestCorrection(input: string, candidates: string[]): string | undefined {
    const lower = input.toLowerCase();
    // Exact substring match: input is in candidate or candidate is in input
    for (const c of candidates) {
        const cLower = c.toLowerCase();
        if (cLower.includes(lower) || lower.includes(cLower)) {
            return c;
        }
    }
    return undefined;
}

/**
 * Keyword-to-command mapping for common mistakes.
 * When user types a keyword as a subcommand/flag, suggest the correct full command.
 */
const KEYWORD_SUGGESTIONS: Record<string, Record<string, { hint: string; params: string[]; next: string }>> = {
    use: {
        'mode':      { hint: 'forja use target', params: ['--mode <debug|release>', '--arch <x86|x64>', '--project <path>'],                         next: 'forja use target --mode <debug|release>' },
        'arch':      { hint: 'forja use target', params: ['--arch <x86|x64>', '--mode <debug|release>', '--project <path>'],                         next: 'forja use target --arch <x86|x64>' },
        'project':   { hint: 'forja use target', params: ['--project <path>', '--mode <debug|release>', '--arch <x86|x64>'],                         next: 'forja use target --project <path>' },
        'qt-path':   { hint: 'forja use qt',     params: ['--qt-path <path>'],                                                                       next: 'forja use qt --qt-path <path>' },
        'server':    { hint: 'forja use remote', params: ['--server <name>'],                                                                        next: 'forja use remote --server <name>' },
        'lang':      { hint: 'forja use lang',   params: ['<zh|en>'],                                                                                next: 'forja use lang <zh|en>' },
        'execution': { hint: 'forja use execution', params: ['--local', '--remote'],                                                                 next: 'forja use execution --local' },
        'local':     { hint: 'forja use execution', params: ['--local'],                                                                             next: 'forja use execution --local' },
        'remote':    { hint: 'forja use remote', params: ['--server <name>'],                                                                        next: 'forja use remote --server <name>' },
        'sync':      { hint: 'forja sync',      params: ['--server <name>', '--remote-path <path>'],                                                next: 'forja sync --server <name> --remote-path <path>' },
    },
};

/**
 * Build an "unknown flags" error message with suggestions for close matches.
 */
function unknownFlagsMessage(unknown: string[], knownFlags: Set<string>): string {
    const suggestions: string[] = [];
    for (const u of unknown) {
        const flagName = u.replace(/ requires a value$/, '');
        const match = suggestCorrection(flagName, [...knownFlags]);
        if (match) { suggestions.push(`${flagName} → ${match}`); }
    }
    const base = `${T('idx.unknownFlags')}: ${unknown.join(', ')}`;
    return suggestions.length > 0 ? `${base}. ${T('idx.didYouMean')}: ${suggestions.join(', ')}?` : base;
}

/**
 * Check for unknown flags in argv. Returns array of unknown flag strings.
 * @param argv - The argument array
 * @param knownFlags - Set of known flags for this command (excluding global flags)
 * @param flagsWithValues - Set of flags that take a value argument (e.g., --server <name>)
 */
function findUnknownFlags(argv: string[], knownFlags: Set<string>, flagsWithValues: Set<string>): string[] {
    const unknown: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) { continue; }
        if (GLOBAL_FLAGS.has(arg)) { continue; }
        if (knownFlags.has(arg)) {
            if (flagsWithValues.has(arg)) {
                const next = argv[i + 1];
                if (!next || next.startsWith('--')) {
                    unknown.push(`${arg} requires a value`);
                } else {
                    i++;
                }
            }
            continue;
        }
        unknown.push(arg);
    }
    return unknown;
}

function extractAllFlags(argv: string[], flag: string): string[] {
    const values: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === flag && argv[i + 1] && !argv[i + 1].startsWith('--')) {
            values.push(argv[i + 1]);
            i++;
        }
    }
    return values;
}

function outputResult(result: ForjaJsonResult, wantsJson: boolean, textFormatter?: (r: unknown) => string): void {
    // When not in JSON mode, strip --json from nextAction for display
    if (!wantsJson && result.nextAction) {
        result = { ...result, nextAction: result.nextAction.replace(/\s+--json/g, '') };
    }
    if (wantsJson) {
        console.log(JSON.stringify(result, null, 2));
    } else if (textFormatter) {
        console.log(textFormatter(result));
    } else {
        const lines: string[] = [];
        if (!result.ok) {
            lines.push('Error');
        }
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                if (d) { lines.push(`${d.message}`); }
            }
        }
        if (result.nextAction) {
            lines.push('Next:');
            const a = result.nextAction; lines.push(`  ${a}`);
        }
        console.log(lines.length > 0 ? lines.join('\n') : JSON.stringify(result, null, 2));
    }
    if (!result.ok) { process.exitCode = 1; }
}

// ── Status ──

function handleStatus(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): void {
    const statusUnknown = findUnknownFlags(argv, new Set(), new Set());
    if (statusUnknown.length > 0) {
        outputResult({ ok: false, action: 'status', diagnostics: [{ level: 'error', message: unknownFlagsMessage(statusUnknown, new Set()) }], nextAction: 'forja status' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const result = runStatus(workspace);
    outputResult(result, wantsJson, (r) => formatStatusText(r as Parameters<typeof formatStatusText>[0], locale));
}

// ── Setup ──

async function handleSetup(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';

    if (subArg === 'remote') {
        // forja setup remote
        const remoteKnown = new Set(['--json', '--reset', '--answers', '--project', '--qt-path', '--vs-install', '--jom-path', '--host', '--username', '--port', '--auth-mode', '--private-key-path', '--name', '--remote-path', '--mode', '--arch']);
        const remoteWithValues = new Set(['--answers', '--project', '--qt-path', '--vs-install', '--jom-path', '--host', '--username', '--port', '--auth-mode', '--private-key-path', '--name', '--remote-path', '--mode', '--arch']);
        const remoteUnknown = findUnknownFlags(argv, remoteKnown, remoteWithValues);
        if (remoteUnknown.length > 0) {
            outputResult({ ok: false, action: 'setup-remote', diagnostics: [{ level: 'error', message: unknownFlagsMessage(remoteUnknown, remoteKnown) }], nextAction: 'forja setup remote' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const { runSetupRemote, formatSetupRemoteText } = await import('./setup');
        const portStr = extractFlag(argv, '--port');
        const port = portStr ? parseInt(portStr, 10) : undefined;
        if (portStr && (isNaN(port!) || port! < 1 || port! > 65535)) {
            outputResult({ ok: false, action: 'setup-remote', diagnostics: [{ level: 'error', message: `${T('idx.invalidPort')}: ${portStr}` }], nextAction: 'forja setup remote' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const result = await runSetupRemote(workspace, {
            json: wantsJson,
            reset: hasFlag(argv, '--reset'),
            answers: extractFlag(argv, '--answers'),
            project: extractFlag(argv, '--project'),
            qtPath: extractFlag(argv, '--qt-path'),
            vsInstall: extractFlag(argv, '--vs-install'),
            jomPath: extractFlag(argv, '--jom-path'),
            host: extractFlag(argv, '--host'),
            username: extractFlag(argv, '--username'),
            port,
            authMode: extractFlag(argv, '--auth-mode'),
            privateKeyPath: extractFlag(argv, '--private-key-path'),
            name: extractFlag(argv, '--name'),
            remotePath: extractFlag(argv, '--remote-path'),
            mode: extractFlag(argv, '--mode'),
            arch: extractFlag(argv, '--arch'),
        });
        outputResult(result, wantsJson, (r) => formatSetupRemoteText(r as Parameters<typeof formatSetupRemoteText>[0]));
        if (!result.ok) { process.exitCode = 1; }
        return;
    }

    // forja setup (local only)
    const setupKnown = new Set(['--json', '--reset', '--answers', '--project', '--qt-path', '--vs-install', '--jom-path', '--mode', '--arch']);
    const setupWithValues = new Set(['--answers', '--project', '--qt-path', '--vs-install', '--jom-path', '--mode', '--arch']);
    const setupUnknown = findUnknownFlags(argv, setupKnown, setupWithValues);
    if (setupUnknown.length > 0) {
        outputResult({ ok: false, action: 'setup', diagnostics: [{ level: 'error', message: unknownFlagsMessage(setupUnknown, setupKnown) }], nextAction: 'forja setup' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const result = await runSetup(workspace, {
        json: wantsJson,
        reset: hasFlag(argv, '--reset'),
        answers: extractFlag(argv, '--answers'),
        project: extractFlag(argv, '--project'),
        qtPath: extractFlag(argv, '--qt-path'),
        vsInstall: extractFlag(argv, '--vs-install'),
        jomPath: extractFlag(argv, '--jom-path'),
        mode: extractFlag(argv, '--mode'),
        arch: extractFlag(argv, '--arch'),
    });
    outputResult(result, wantsJson, (r) => formatSetupText(r as Parameters<typeof formatSetupText>[0]));
    if (!result.ok) { process.exitCode = 1; }
}

// ── List ──

async function handleList(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const listKnown = new Set<string>();
    const listUnknown = findUnknownFlags(argv, listKnown, new Set<string>());
    if (listUnknown.length > 0) {
        outputResult({ ok: false, action: 'list', diagnostics: [{ level: 'error', message: unknownFlagsMessage(listUnknown, listKnown) }], nextAction: 'forja list targets' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // Determine category from first positional arg after 'list'
    const categoryArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    const validCategories = ['targets', 'env', 'remote', 'lang'];

    // Require a category
    if (!categoryArg) {
        outputResult({
            ok: false,
            action: 'list',
            diagnostics: [{
                level: 'error',
                message: T('idx.listCategoryRequired'),
            }],
            nextAction: 'forja list targets',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // Error on unknown category instead of silently falling back
    if (!validCategories.includes(categoryArg)) {
        outputResult({
            ok: false,
            action: 'list',
            category: categoryArg,
            workspace,
            diagnostics: [{
                level: 'error',
                message: (() => {
                    const base = `${T('idx.unknownListCategory')}: ${categoryArg}. ${T('idx.validCategories')}: ${validCategories.join(', ')}`;
                    const hint = suggestCorrection(categoryArg, validCategories);
                    return hint ? `${base}. ${T('idx.didYouMean')}: ${hint}?` : base;
                })(),
            }],
            nextAction: 'forja list targets',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const category = categoryArg as ListCategory;

    // Parse env sub-category (e.g., `forja list env qt`)
    let envSubCategory: EnvSubCategory | undefined;
    if (category === 'env') {
        const subArg = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
        if (subArg) {
            if (subArg === 'qt' || subArg === 'vs' || subArg === 'jom' || subArg === 'make') {
                envSubCategory = subArg;
            } else {
                const validEnvSubs = ['qt', 'vs', 'jom', 'make'];
                outputResult({
                    ok: false,
                    action: 'list',
                    diagnostics: [{
                        level: 'error',
                        message: `${T('idx.unknownEnvSubcategory')}: ${subArg}. ${T('idx.validCategories')}: ${validEnvSubs.join(', ')}`,
                    }],
                    nextAction: 'forja list env',
                }, wantsJson);
                process.exitCode = 1;
                return;
            }
        }
    }

    const result = await runList(workspace, category, { envSubCategory });
    outputResult(result, wantsJson, (r) => formatListText(r as Parameters<typeof formatListText>[0], locale));
}

// ── Use ──

function handleUse(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): void {
    const useKnown = new Set(['--project','--mode','--arch','--local','--remote','--server','--remote-path','--enable','--disable','--qt-path','--vs-dev-shell','--qmake-target','--qmake-args','--vs-dev-cmd','--role','--path','--baseline','--overlay','--mount','--asset','--artifact','--profile','--clear','--remove']);
    const useWithVal = new Set(['--project','--mode','--arch','--server','--remote-path','--qt-path','--vs-dev-shell','--qmake-target','--qmake-args','--vs-dev-cmd','--role','--path','--baseline','--mount','--asset','--artifact','--profile']);
    const useUnknown = findUnknownFlags(argv, useKnown, useWithVal);
    if (useUnknown.length > 0) {
        outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(useUnknown, useKnown) }], nextAction: 'forja use target' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const subCmd = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';

    switch (subCmd) {
        case 'target': {
            const result = runUseTarget(workspace, {
                project: extractFlag(argv, '--project'),
                mode: extractFlag(argv, '--mode') as 'debug' | 'release' | undefined,
                arch: extractFlag(argv, '--arch') as 'x86' | 'x64' | undefined,
            });
            outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
            return;
        }
        case 'execution': {
            const result = runUseExecution(workspace, hasFlag(argv, '--local'), hasFlag(argv, '--remote'));
            outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
            return;
        }
        case 'remote': {
            const remoteSubCmd = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';

            // Simplified 2-level: no set/clear action layer
            // Pattern: no args = show current, with args = set, --clear = clear
            if (remoteSubCmd === 'workspace') {
                const result = runUseRemoteWorkspace(workspace, {
                    action: hasFlag(argv, '--clear') ? 'clear' : 'set',
                    mode: extractFlag(argv, '--mode') as 'legacy' | 'staged' | undefined,
                    path: extractFlag(argv, '--path'),
                    profile: extractFlag(argv, '--profile'),
                });
                outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
                return;
            }
            if (remoteSubCmd === 'repo') {
                const repoAction = hasFlag(argv, '--clear') ? 'clear'
                    : hasFlag(argv, '--remove') ? 'remove' : 'set';
                const assetRaw = extractAllFlags(argv, '--asset');
                const assets = assetRaw.length > 0 ? assetRaw.map(a => {
                    const eq = a.indexOf('=');
                    return eq >= 0
                        ? { localPath: a.slice(0, eq), remotePath: a.slice(eq + 1) }
                        : { localPath: a };
                }) : undefined;
                const overlayRaw = extractFlag(argv, '--overlay');
                const result = runUseRemoteRepo(workspace, {
                    action: repoAction as 'set' | 'remove' | 'clear',
                    localName: extractFlag(argv, '--local'),
                    remoteName: extractFlag(argv, '--remote'),
                    role: extractFlag(argv, '--role') as 'primary' | 'mapped' | 'remote-only' | 'existing-remote' | 'skip' | undefined,
                    remotePath: extractFlag(argv, '--path'),
                    baseline: extractFlag(argv, '--baseline') as 'auto' | 'status-only' | undefined,
                    overlay: overlayRaw !== undefined ? overlayRaw === 'true' : undefined,
                    mount: extractFlag(argv, '--mount') as 'symlink' | undefined,
                    assets,
                });
                outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
                return;
            }
            if (remoteSubCmd === 'forja-bin') {
                const result = runUseRemoteForjaBin(workspace, {
                    action: hasFlag(argv, '--clear') ? 'clear' : 'set',
                    path: extractFlag(argv, '--path'),
                });
                outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
                return;
            }
            if (remoteSubCmd === 'build-order') {
                // Parse positional args after 'build-order' as items
                const items: Array<{ target: 'qt' | 'sdk'; action: string }> = [];
                const invalidItems: string[] = [];
                for (let i = 3; i < argv.length; i++) {
                    if (argv[i].startsWith('--')) { continue; }
                    const [target, action] = argv[i].split(':');
                    if (target === 'qt' || target === 'sdk') {
                        items.push({ target, action: action || 'build' });
                    } else {
                        invalidItems.push(argv[i]);
                    }
                }
                const result = runUseRemoteBuildOrder(workspace, {
                    action: hasFlag(argv, '--clear') ? 'clear' : 'set',
                    items: items.length > 0 ? items : undefined,
                    invalidItems: invalidItems.length > 0 ? invalidItems : undefined,
                });
                outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
                return;
            }
            if (remoteSubCmd === 'transfer') {
                const result = runUseRemoteTransfer(workspace, {
                    action: hasFlag(argv, '--clear') ? 'clear' : 'set',
                    deployServer: extractFlag(argv, '--server'),
                    deployPath: extractFlag(argv, '--path'),
                    artifacts: extractAllFlags(argv, '--artifact'),
                });
                outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
                return;
            }

            // Default: set server and remote-path
            const result = runUseRemote(workspace, {
                server: extractFlag(argv, '--server'),
                remotePath: extractFlag(argv, '--remote-path'),
            });
            outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
            return;
        }
        case 'qt': {
            const result = runUseQt(workspace, {
                qtPath: extractFlag(argv, '--qt-path'),
                vsDevShell: extractFlag(argv, '--vs-dev-shell'),
                qmakeTarget: extractFlag(argv, '--qmake-target'),
                qmakeArgs: extractFlag(argv, '--qmake-args'),
            });
            outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
            return;
        }
        case 'sdk': {
            const result = runUseSdk(workspace, {
                vsDevCmd: extractFlag(argv, '--vs-dev-cmd'),
            });
            outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
            return;
        }
        case 'lang': {
            const langValue = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
            if (!langValue) {
                outputResult({
                    ok: false,
                    action: 'use',
                    useScope: 'lang',
                    changed: [],
                    diagnostics: [{ level: 'error', message: T('langMissingValue') }],
                    nextAction: 'forja use lang zh',
                }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const result = runUseLang(langValue, locale);
            outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
            return;
        }
        default: {
            if (subCmd !== '') {
                const USE_SUBCOMMANDS = ['target', 'execution', 'remote', 'qt', 'sdk', 'lang'];
                const keywordEntry = KEYWORD_SUGGESTIONS['use']?.[subCmd];
                const keywordHint = keywordEntry ? `${keywordEntry.hint} ${keywordEntry.params.map(p => `[${p}]`).join(' ')}` : undefined;
                const substringHint = suggestCorrection(subCmd, USE_SUBCOMMANDS);
                const fallbackHint = substringHint ? `forja use ${substringHint}` : undefined;
                const hint = keywordHint || fallbackHint;
                const msg = hint
                    ? `${T('idx.unknownUseSubcommand')}: ${subCmd}. ${T('idx.didYouMean')}: ${hint}?`
                    : `${T('idx.unknownUseSubcommand')}: ${subCmd}`;
                const nextAction = keywordEntry ? keywordEntry.next : (hint || 'forja use target');
                outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: msg }], nextAction }, wantsJson);
                process.exitCode = 1;
                return;
            }
            // No subcommand — show help
            const result: ForjaJsonResult = {
                ok: true,
                action: 'use',
                diagnostics: [{ level: 'info', message: T('idx.useUsage') }],
                nextAction: 'forja use target --project <path>',
            };
            outputResult(result, wantsJson);
        }
    }
}

// ── Server ──

async function handleServer(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const srvKnown = new Set(['--name','--host','--username','--port','--auth-mode','--private-key-path','--password','--strict-host-key-checking','--no-strict-host-key-checking','--detail']);
    const srvWithVal = new Set(['--name','--host','--username','--port','--auth-mode','--private-key-path','--password','--detail']);
    const srvUnknown = findUnknownFlags(argv, srvKnown, srvWithVal);
    if (srvUnknown.length > 0) {
        outputResult({ ok: false, action: 'server', serverAction: 'add', changed: [], diagnostics: [{ level: 'error', message: unknownFlagsMessage(srvUnknown, srvKnown) }], nextAction: 'forja server add' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const subCmd = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';

    switch (subCmd) {
        case 'add': {
            const portStr = extractFlag(argv, '--port');
            let port: number | undefined;
            if (portStr) {
                port = parseInt(portStr, 10);
                if (isNaN(port) || port < 1 || port > 65535) {
                    outputResult({
                        ok: false,
                        action: 'server',
                        serverAction: 'add',
                        changed: [],
                        diagnostics: [{
                            level: 'error',
                            message: `${T('idx.invalidPort')}: ${portStr}. ${T('idx.invalidPortHint')}`,
                        }],
                        nextAction: 'forja server add --port 22',
                    }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
            }
            const result = runServerAdd({
                name: extractFlag(argv, '--name') || '',
                host: extractFlag(argv, '--host') || '',
                username: extractFlag(argv, '--username') || '',
                port,
                authMode: extractFlag(argv, '--auth-mode') as 'key' | 'password' | undefined,
                privateKeyPath: extractFlag(argv, '--private-key-path'),
                password: extractFlag(argv, '--password'),
                strictHostKeyChecking: hasFlag(argv, '--strict-host-key-checking') ? true : hasFlag(argv, '--no-strict-host-key-checking') ? false : undefined,
            });
            outputResult(result, wantsJson, (r) => formatServerText(r as Parameters<typeof formatServerText>[0], locale));
            return;
        }
        case 'update': {
            const id = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
            if (!id) {
                outputResult({
                    ok: false, action: 'server', serverAction: 'update', changed: [],
                    diagnostics: [{ level: 'error', message:'Server ID required: forja server update <id>' }],
                    nextAction: 'forja server',
                }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const portStr = extractFlag(argv, '--port');
            let port: number | undefined;
            if (portStr) {
                port = parseInt(portStr, 10);
                if (isNaN(port) || port < 1 || port > 65535) {
                    outputResult({
                        ok: false,
                        action: 'server',
                        serverAction: 'update',
                        changed: [],
                        diagnostics: [{
                            level: 'error',
                            message: `${T('idx.invalidPort')}: ${portStr}. ${T('idx.invalidPortHint')}`,
                        }],
                        nextAction: 'forja server update <id> --port 22',
                    }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
            }
            const result = runServerUpdate(id, {
                name: extractFlag(argv, '--name'),
                host: extractFlag(argv, '--host'),
                username: extractFlag(argv, '--username'),
                port,
                authMode: extractFlag(argv, '--auth-mode') as 'key' | 'password' | undefined,
                privateKeyPath: extractFlag(argv, '--private-key-path'),
                password: extractFlag(argv, '--password'),
                strictHostKeyChecking: hasFlag(argv, '--strict-host-key-checking') ? true : hasFlag(argv, '--no-strict-host-key-checking') ? false : undefined,
            });
            outputResult(result, wantsJson, (r) => formatServerText(r as Parameters<typeof formatServerText>[0], locale));
            return;
        }
        case 'remove': {
            const id = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
            if (!id) {
                outputResult({
                    ok: false, action: 'server', serverAction: 'remove', changed: [],
                    diagnostics: [{ level: 'error', message:'Server ID required: forja server remove <id>' }],
                    nextAction: 'forja server',
                }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const result = runServerRemove(id);
            outputResult(result, wantsJson, (r) => formatServerText(r as Parameters<typeof formatServerText>[0], locale));
            return;
        }
        default: {
            if (subCmd !== '') {
                const SERVER_SUBCOMMANDS = ['add', 'update', 'remove'];
                const hint = suggestCorrection(subCmd, SERVER_SUBCOMMANDS);
                const msg = hint
                    ? `${T('idx.unknownServerSubcommand')}: ${subCmd}. ${T('idx.didYouMean')}: ${hint}?`
                    : `${T('idx.unknownServerSubcommand')}: ${subCmd}`;
                outputResult({ ok: false, action: 'server', serverAction: 'add', changed: [], diagnostics: [{ level: 'error', message: msg }], nextAction: hint ? `forja server ${hint}` : 'forja server add' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const detailId = extractFlag(argv, '--detail');
            const result = await runList(workspace, 'servers', { detailId });
            outputResult(result, wantsJson, (r) => formatListText(r as Parameters<typeof formatListText>[0], locale));
        }
    }
}

// ── Build ──

async function handleBuild(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const buildUnknown = findUnknownFlags(argv, new Set(['--plan', '--project']), new Set(['--project']));
    if (buildUnknown.length > 0) {
        outputResult({ ok: false, action: 'build', buildAction: 'default', workspace, diagnostics: [{ level: 'error', message: unknownFlagsMessage(buildUnknown, new Set(['--plan','--project'])) }], nextAction: 'forja build' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    let buildAction: BuildAction = 'default';
    if (subArg === 'fresh') { buildAction = 'fresh'; }
    else if (subArg === 'qmake') { buildAction = 'qmake'; }
    else if (subArg === 'rcc') { buildAction = 'rcc'; }
    else if (subArg !== '') {
        // Unknown subaction - error with suggestion
        const BUILD_ACTIONS = ['fresh', 'qmake', 'rcc'];
        const buildHint = suggestCorrection(subArg, BUILD_ACTIONS);
        const buildMsg = buildHint
            ? `${T('idx.unknownBuildAction')}: ${subArg}. ${T('idx.didYouMean')}: ${buildHint}?`
            : `${T('idx.unknownBuildAction')}: ${subArg}. ${T('idx.validActions')}`;
        outputResult({
            ok: false,
            action: 'build',
            buildAction: 'default',
            workspace,
            diagnostics: [{ level: 'error', message: buildMsg }],
            nextAction: buildHint ? `forja build ${buildHint}` : 'forja build',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const result = await runBuild(workspace, buildAction, { plan: hasFlag(argv, '--plan'), json: wantsJson, project: extractFlag(argv, '--project') });
    outputBuildResult(result, wantsJson);
    if (!result.ok) { process.exitCode = 1; }
}

// ── Run ──

async function handleRun(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const runUnknown = findUnknownFlags(argv, new Set(['--detach', '--debug', '--custom', '--plan']), new Set(['--custom']));
    if (runUnknown.length > 0) {
        outputResult({ ok: false, action: 'run', diagnostics: [{ level: 'error', message: unknownFlagsMessage(runUnknown, new Set(['--detach','--debug','--custom','--plan'])) }], nextAction: 'forja run' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    // Check for 'designer' subcommand: `forja run designer <ui-file>`
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    if (subArg === 'designer') {
        const uiFile = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
        if (!uiFile) {
            outputResult({
                ok: false,
                action: 'run',
                runAction: 'designer',
                diagnostics: [{ level: 'error', message: T('idx.runDesignerUsage') }],
            }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const result = await runRun(workspace, { designer: uiFile, json: wantsJson });
        outputRunResult(result, wantsJson);
        if (!result.ok) { process.exitCode = 1; }
        return;
    }

    // Check for unknown positional args (not flags, not empty)
    if (subArg !== '') {
        outputResult({
            ok: false,
            action: 'run',
            runAction: 'default',
            workspace,
            diagnostics: [{ level: 'error', message: `${T('idx.unknownArgument')}: ${subArg}. ${T('idx.runDesignerHint')}` }],
            nextAction: 'forja run',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const result = await runRun(workspace, {
        detach: hasFlag(argv, '--detach'),
        debug: hasFlag(argv, '--debug'),
        custom: extractFlag(argv, '--custom'),
        plan: hasFlag(argv, '--plan'),
        json: wantsJson,
    });
    outputRunResult(result, wantsJson);
    if (!result.ok) { process.exitCode = 1; }
}

// ── Stop ──

async function handleStop(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const stopUnknown = findUnknownFlags(argv, new Set(), new Set());
    if (stopUnknown.length > 0) {
        outputResult({ ok: false, action: 'stop', diagnostics: [{ level: 'error', message: unknownFlagsMessage(stopUnknown, new Set()) }], nextAction: 'forja stop' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const stopPosArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    if (stopPosArg) {
        outputResult({ ok: false, action: 'stop', diagnostics: [{ level: 'error', message: `${T('idx.unexpectedArgument')}: ${stopPosArg}` }], nextAction: 'forja stop' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const result = await runStop(workspace, { json: wantsJson });
    outputStopResult(result, wantsJson);
    if (!result.ok) { process.exitCode = 1; }
}

// ── Clean ──

async function handleClean(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const cleanUnknown = findUnknownFlags(argv, new Set(['--plan']), new Set());
    if (cleanUnknown.length > 0) {
        outputResult({ ok: false, action: 'clean', diagnostics: [{ level: 'error', message: unknownFlagsMessage(cleanUnknown, new Set(['--plan'])) }], nextAction: 'forja clean' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const cleanPosArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    if (cleanPosArg) {
        outputResult({ ok: false, action: 'clean', diagnostics: [{ level: 'error', message: `${T('idx.unexpectedArgument')}: ${cleanPosArg}` }], nextAction: 'forja clean' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const result = await runClean(workspace, { plan: hasFlag(argv, '--plan'), json: wantsJson });
    outputCleanResult(result, wantsJson);
    if (!result.ok) { process.exitCode = 1; }
}

// ── Doctor ──

async function handleDoctor(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    // Check for unknown flags
    const doctorKnownFlags = new Set(['--fix', '--unlock', '--restore', '--reset', '--clean-untracked', '--remote', '--server', '--force', '--recursive', '--plan']);
    const doctorFlagsWithValues = new Set(['--server']);
    const unknownFlags = findUnknownFlags(argv, doctorKnownFlags, doctorFlagsWithValues);
    if (unknownFlags.length > 0) {
        outputResult({
            ok: false, action: 'doctor', changed: [],
            diagnostics: [{ level: 'error', message: unknownFlagsMessage(unknownFlags, doctorKnownFlags) }],
            nextAction: 'forja doctor',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    let unlockId: string | undefined;
    let fix = false;
    let restore: { repo: string; paths: string[] } | undefined;
    let reset: { repo: string; paths: string[] } | undefined;
    let cleanUntracked: { repo: string; paths: string[]; recursive?: boolean } | undefined;

    if (subArg === 'fix') { fix = true; }
    else if (subArg === 'unlock') {
        unlockId = argv[2] && !argv[2].startsWith('--') ? argv[2] : undefined;
    }
    else if (subArg === 'restore' || subArg === 'reset') {
        // Spec: forja doctor restore <repo> <paths...> [--force] [--workspace <path>] [--json]
        const repo = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
        const paths = collectPositionalPaths(argv, 3);
        if (!repo || paths.length === 0) {
            outputResult({
                ok: false, action: 'doctor', doctorAction: subArg, changed: [],
                diagnostics: [{ level: 'error', message:`forja doctor ${subArg} requires <repo> and at least one <path>` }],
                nextAction: `forja doctor ${subArg} <repo> <paths...>`,
            }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const param = { repo, paths };
        if (subArg === 'restore') { restore = param; } else { reset = param; }
    }
    else if (subArg === 'clean-untracked') {
        // Spec: forja doctor clean-untracked <repo> <paths...> [--recursive] [--force] [--workspace <path>] [--json]
        const repo = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
        const paths = collectPositionalPaths(argv, 3);
        if (!repo || paths.length === 0) {
            outputResult({
                ok: false, action: 'doctor', doctorAction: 'clean-untracked', changed: [],
                diagnostics: [{ level: 'error', message:'forja doctor clean-untracked requires <repo> and at least one <path>' }],
                nextAction: 'forja doctor clean-untracked <repo> <paths...>',
            }, wantsJson);
            process.exitCode = 1;
            return;
        }
        cleanUntracked = { repo, paths, recursive: hasFlag(argv, '--recursive') };
    }

    const result = await runDoctor(workspace, {
        remote: hasFlag(argv, '--remote'),
        server: extractFlag(argv, '--server'),
        fix,
        unlock: unlockId,
        force: hasFlag(argv, '--force'),
        plan: hasFlag(argv, '--plan'),
        restore,
        reset,
        cleanUntracked,
    });
    outputResult(result, wantsJson, (r) => formatDoctorText(r as Parameters<typeof formatDoctorText>[0], locale));
}

function collectPositionalPaths(argv: string[], startIdx: number): string[] {
    // Flags that consume a following value argument
    const VALUE_FLAGS = new Set(['--workspace', '--server', '--config']);
    const paths: string[] = [];
    for (let i = startIdx; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            // Skip the next token if this flag takes a value
            if (VALUE_FLAGS.has(argv[i]) && i + 1 < argv.length) { i++; }
            continue;
        }
        paths.push(argv[i]);
    }
    return paths;
}

// ── Sync ──

async function handleSync(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const syncUnknown = findUnknownFlags(argv, new Set(['--yes', '--reset', '--file', '--server', '--remote-path']), new Set(['--file', '--server', '--remote-path']));
    if (syncUnknown.length > 0) {
        outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: `${T('sync.unknownFlag')}: ${syncUnknown.join(', ')}` }], nextAction: 'forja sync' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const fmt = (r: unknown) => formatSyncText(r as Parameters<typeof formatSyncText>[0], locale);
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    const files = extractAllFlags(argv, '--file');

    // --reset: clear sync state and exit
    if (hasFlag(argv, '--reset')) {
        const extraPositional = argv.slice(1).filter(a => !a.startsWith('--'));
        if (extraPositional.length > 0 || subArg === 'plan') {
            const conflicts = [...extraPositional, ...(subArg === 'plan' ? ['plan'] : [])];
            outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: `--reset ${T('sync.resetConflict')}: ${conflicts.join(', ')}` }], nextAction: 'forja sync' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const result = runSyncReset(workspace);
        outputResult(result, wantsJson, fmt);
        return;
    }

    // ── 子命令校验（在配置处理之前） ──
    if (subArg !== '' && subArg !== 'plan' && subArg !== 'status') {
        outputResult({
            ok: false,
            action: 'sync',
            syncAction: 'run',
            workspace,
            diagnostics: [{
                level: 'error',
                message: `${T('sync.unknownAction')}: ${subArg}`,
            }],
            nextAction: 'forja sync',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // status: 显示配置，不需要 sync 前置配置
    if (subArg === 'status') {
        const result = runSyncStatus(workspace);
        outputResult(result, wantsJson, fmt);
        return;
    }

    // ── 配置处理：--server / --remote-path / 交互式引导 ──
    const serverFlag = extractFlag(argv, '--server');
    const remotePathFlag = extractFlag(argv, '--remote-path');

    if (serverFlag || remotePathFlag) {
        // 显式指定服务器和/或远程路径
        let serverId: string | undefined;
        if (serverFlag) {
            const resolved = resolveServerSelector(serverFlag);
            if (resolved.ambiguous) {
                outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: `${T('sync.serverNotFound')}: "${serverFlag}" (${T('sync.ambiguous')})` }], nextAction: 'forja list servers' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            if (!resolved.server) {
                outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: `${T('sync.serverNotFound')}: "${serverFlag}"` }], nextAction: 'forja server' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            serverId = resolved.server.id;
        }

        if (!serverId) {
            // --remote-path only: use existing selectedServer
            const project = readProjectSyncConfig(workspace);
            if (!project.selectedServer) {
                outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: T('sync.notConfigured') }], nextAction: 'forja sync --server <name> --remote-path <path>' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            serverId = project.selectedServer;
        }

        const cfg = configureSyncSettings(workspace, { serverId, remotePath: remotePathFlag, enable: true });
        if (!cfg.ok) {
            outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: cfg.error }], nextAction: 'forja doctor' }, wantsJson);
            process.exitCode = 1;
            return;
        }
    } else if (!wantsJson) {
        // 无 flag，检查配置是否完整（轻量检查，不跑 plan）
        const syncCfg = readProjectSyncConfig(workspace);
        const serverExists = syncCfg.selectedServer ? readServers().some(s => s.id === syncCfg.selectedServer) : false;
        const needsSetup = !syncCfg.enabled || !syncCfg.selectedServer || !serverExists || !syncCfg.remotePaths[syncCfg.selectedServer];
        if (needsSetup) {
            const guided = await interactiveSyncSetup(workspace);
            if (!guided) {
                process.exitCode = 1;
                return;
            }
        }
    } else {
        // JSON mode, no flags — let the sync itself report the error with nextAction
    }

    if (subArg === 'plan') {
        const result = await runSyncPlan(workspace, files);
        outputResult(result, wantsJson, fmt);
        return;
    }

    // Default: interactive plan → confirm → execute
    if (!wantsJson && !hasFlag(argv, '--yes')) {
        const plan = await runSyncPlan(workspace, files);
        if (!plan.ok) { outputResult(plan, false, fmt); process.exitCode = 1; return; }
        const pendingCount = (plan.plan?.pending?.length ?? 0) + (plan.plan?.deleted?.length ?? 0);
        if (pendingCount === 0) { console.log(T('syncNothing')); return; }
        // 交互确认中的 plan 只是中间步骤，不显示 nextAction（用户已在 forja sync 流程中）
        (plan as any).nextAction = undefined;
        console.log(formatSyncText(plan as Parameters<typeof formatSyncText>[0], locale));
        console.log();
        const yes = await confirm(T('syncConfirm'), false);
        if (!yes) { console.log(T('syncCancelled')); process.exitCode = 1; return; }

        // Reuse plan data to avoid re-running git status
        const gitRoots = resolveGitRoots(workspace);
        const classified: ClassifiedChanges = {
            pending: plan.plan?.pending ?? [],
            deleted: plan.plan?.deleted ?? [],
            skipped: plan.plan?.skipped ?? [],
            skippedDetails: plan.plan?.skippedDetails ?? [],
            gitRoots: (plan.plan?.repos ?? []).map(name => gitRoots.find(g => g.name === name)).filter(Boolean) as ReturnType<typeof resolveGitRoots>,
            requestedFilesNotFound: false,
        };
        const result = await runSyncExecute(workspace, files, classified);
        outputResult(result, wantsJson, fmt);
        return;
    }
    const result = await runSyncExecute(workspace, files);
    outputResult(result, wantsJson, fmt);
}

/**
 * 交互式引导用户完成 sync 配置（选择/创建服务器 + 输入远程路径）。
 * 返回 true 表示配置完成，false 表示失败或用户取消。
 */
async function interactiveSyncSetup(workspace: string): Promise<boolean> {
    const existingServers = readServers();
    let serverId: string | undefined;
    let selectedServer: { username: string } | undefined;

    if (existingServers.length === 0) {
        // 零服务器 — 引导创建
        console.log(T('sync.notConfigured'));
        const host = await prompt(T('setupPromptHost'));
        if (!host) return false;
        const username = await prompt(T('setupPromptUsername'));
        if (!username) return false;
        const portStr = await prompt(T('setupPromptPort'), '22');
        const port = parseInt(portStr || '22', 10);
        if (isNaN(port) || port < 1 || port > 65535) return false;
        const authChoice = await choose(T('setupPromptAuthMode'), ['key', 'password'] as const, m => m === 'key' ? T('setupAuthKey') : T('setupAuthPassword'));
        const authMode = authChoice || 'key';
        let privateKeyPath = '';
        let password = '';
        if (authMode === 'key') {
            privateKeyPath = await prompt(T('setupPromptPrivateKey'), '') || '';
        } else {
            password = await prompt(T('setupPromptPassword')) || '';
        }
        const name = await prompt(T('setupPromptName'), host) || host;
        try {
            const created = addServer({ name, host, username, port, authMode, privateKeyPath, password });
            serverId = created.id;
            selectedServer = created;
            console.log(`${T('setupServerCreated')}: ${created.name} (${created.host})`);
        } catch {
            return false;
        }
    } else if (existingServers.length === 1) {
        // 单服务器 — 自动选择
        serverId = existingServers[0].id;
        selectedServer = existingServers[0];
    } else {
        // 多服务器 — 交互选择
        const server = await choose(T('setupSelectServer'), existingServers, s => `${s.name} (${s.username}@${s.host})`);
        if (!server) return false;
        serverId = server.id;
        selectedServer = server;
    }

    // 远程路径：已有则复用，否则提示输入
    const syncCfg = readProjectSyncConfig(workspace);
    let remotePath = syncCfg.remotePaths[serverId || ''] || '';
    if (!remotePath) {
        const defaultPath = `/home/${selectedServer?.username || 'user'}/${path.basename(workspace)}`;
        remotePath = await prompt(T('setupRemotePathPrompt'), defaultPath);
        if (!remotePath) return false;
    }

    const cfg = configureSyncSettings(workspace, { serverId: serverId!, remotePath, enable: true });
    if (!cfg.ok) return false;

    console.log();
    return true;
}
