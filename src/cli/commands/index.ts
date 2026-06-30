/**
 * CLI entry — dispatches to 11 top-level commands.
 * Called by src/cli/index.ts.
 */
import * as path from 'path';
import { ForjaJsonResult } from './types';
import { runStatus, formatStatusText } from './status';
import { runSetup, formatSetupText } from './setup';
import { runList, ListCategory, EnvSubCategory, formatListText } from './list';
import { runUseTarget, runUseExecution, runUseSync, runUseRemote, runUseRemoteWorkspace, runUseRemoteRepo, runUseRemoteForjaBin, runUseRemoteBuildOrder, runUseRemoteTransfer, runUseQt, runUseSdk, runUseLang, formatUseText } from './use';
import { runServerAdd, runServerUpdate, runServerRemove, formatServerText } from './server';
import { runBuild, BuildAction, outputBuildResult } from './build';
import { runRun, outputRunResult } from './run';
import { runStop } from './stop';
import { runClean, outputCleanResult } from './clean';
import { runDoctor, formatDoctorText } from './doctor';
import { runSyncPlan, runSyncExecute, runSyncReset, runSyncTransfer, runSyncStatus, SyncAction, formatSyncText } from './sync';
import { confirm } from './prompt';
import { resolveLocale, Locale, T, setGlobalLocale } from './types';
import { loadGlobalConfig } from '../../core/settingsIO';

type Command = 'status' | 'setup' | 'list' | 'use' | 'server' | 'build' | 'run' | 'stop' | 'clean' | 'doctor' | 'sync';

const COMMANDS: Command[] = ['status', 'setup', 'list', 'use', 'server', 'build', 'run', 'stop', 'clean', 'doctor', 'sync'];

// Commands implemented in this module (Stage 2-4)
const IMPLEMENTED_COMMANDS: Command[] = ['status', 'setup', 'list', 'use', 'server', 'build', 'run', 'stop', 'clean', 'doctor', 'sync'];

export function isCommand(cmd: string): cmd is Command {
    return COMMANDS.includes(cmd as Command);
}

export function isImplementedCommand(cmd: string): boolean {
    return IMPLEMENTED_COMMANDS.includes(cmd as Command);
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
        server: T('help.server'),
        build: T('help.build'),
        run: T('help.run'),
        stop: T('help.stop'),
        clean: T('help.clean'),
        doctor: T('help.doctor'),
        sync: T('help.sync'),
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
            return handleServer(argv, wantsJson, locale);
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
                outputResult({ ok: false, action: command, diagnostics: [{ level: 'error', message: msg }], nextActions: suggestion ? [`forja ${suggestion}`] : ['forja --help'] }, wantsJson);
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
        'sync':      { hint: 'forja use sync',   params: ['--server <name>', '--remote-path <path>'],                                                next: 'forja use sync --server <name> --remote-path <path>' },
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

export function stripJson(actions: string[] | undefined): string[] | undefined {
    if (!actions) { return actions; }
    return actions.map(a => a.replace(/\s*--json\b/g, ''));
}

function outputResult(result: ForjaJsonResult, wantsJson: boolean, textFormatter?: (r: unknown) => string): void {
    // When not in JSON mode, strip --json from nextActions for display
    if (!wantsJson && result.nextActions) {
        result = { ...result, nextActions: (result.nextAction?.replace(/\s+--json/g, '') || undefined) };
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
            if (result.nextAction) {
            const a = result.nextAction; lines.push(`  ${a}`); }
        }
        console.log(lines.length > 0 ? lines.join('\n') : JSON.stringify(result, null, 2));
    }
    if (!result.ok) { process.exitCode = 1; }
}

// ── Status ──

function handleStatus(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): void {
    const statusUnknown = findUnknownFlags(argv, new Set(['--process']), new Set());
    if (statusUnknown.length > 0) {
        outputResult({ ok: false, action: 'status', diagnostics: [{ level: 'error', message: unknownFlagsMessage(statusUnknown, new Set(['--process'])) }], nextAction: 'forja status' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const result = runStatus(workspace, {
        process: hasFlag(argv, '--process'),
    });
    outputResult(result, wantsJson, (r) => formatStatusText(r as Parameters<typeof formatStatusText>[0], locale));
}

// ── Setup ──

async function handleSetup(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';

    if (subArg === 'remote') {
        // forja setup remote
        const remoteUnknown = findUnknownFlags(argv, new Set(['--plan']), new Set());
        if (remoteUnknown.length > 0) {
            outputResult({ ok: false, action: 'setup-remote', diagnostics: [{ level: 'error', message: unknownFlagsMessage(remoteUnknown, new Set(['--plan'])) }], nextAction: 'forja setup remote' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const { runSetupRemote, formatSetupRemoteText } = await import('./setup');
        const result = await runSetupRemote(workspace, {
            plan: hasFlag(argv, '--plan'),
            json: wantsJson,
        });
        outputResult(result, wantsJson, (r) => formatSetupRemoteText(r as Parameters<typeof formatSetupRemoteText>[0]));
        if (!result.ok) { process.exitCode = 1; }
        return;
    }

    // forja setup (local only)
    const setupUnknown = findUnknownFlags(argv, new Set(['--plan']), new Set());
    if (setupUnknown.length > 0) {
        outputResult({ ok: false, action: 'setup', diagnostics: [{ level: 'error', message: unknownFlagsMessage(setupUnknown, new Set(['--plan'])) }], nextAction: 'forja setup' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const result = await runSetup(workspace, {
        plan: hasFlag(argv, '--plan'),
        json: wantsJson,
    });
    outputResult(result, wantsJson, (r) => formatSetupText(r as Parameters<typeof formatSetupText>[0]));
    if (!result.ok) { process.exitCode = 1; }
}

// ── List ──

async function handleList(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const listUnknown = findUnknownFlags(argv, new Set(['--detail']), new Set(['--detail']));
    if (listUnknown.length > 0) {
        outputResult({ ok: false, action: 'list', diagnostics: [{ level: 'error', message: unknownFlagsMessage(listUnknown, new Set(['--detail'])) }], nextAction: 'forja list targets' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // Determine category from first positional arg after 'list'
    const categoryArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    const validCategories = ['targets', 'servers', 'env', 'remote', 'remote-repos', 'config', 'lang'];

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
    const detailId = extractFlag(argv, '--detail');

    // Parse env sub-category (e.g., `forja list env qt`)
    let envSubCategory: EnvSubCategory | undefined;
    if (category === 'env') {
        const subArg = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
        if (subArg === 'qt' || subArg === 'vs') {
            envSubCategory = subArg;
        }
    }

    const result = await runList(workspace, category, { detailId, envSubCategory });
    outputResult(result, wantsJson, (r) => formatListText(r as Parameters<typeof formatListText>[0], locale));
}

// ── Use ──

function handleUse(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): void {
    const useKnown = new Set(['--project','--mode','--arch','--local','--remote','--server','--remote-path','--enable','--disable','--detail','--qt-path','--vs-dev-shell','--qmake-target','--qmake-args','--vs-dev-cmd','--role','--path','--baseline','--overlay','--mount','--asset','--artifact','--profile','--clear','--remove']);
    const useWithVal = new Set(['--project','--mode','--arch','--local','--remote','--server','--remote-path','--detail','--qt-path','--vs-dev-shell','--qmake-target','--qmake-args','--vs-dev-cmd','--role','--path','--baseline','--mount','--asset','--artifact','--profile']);
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
        case 'sync': {
            const result = runUseSync(workspace, {
                server: extractFlag(argv, '--server'),
                remotePath: extractFlag(argv, '--remote-path'),
                enable: hasFlag(argv, '--enable') ? true : undefined,
                disable: hasFlag(argv, '--disable') ? true : undefined,
            });
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
                for (let i = 3; i < argv.length; i++) {
                    if (argv[i].startsWith('--')) { continue; }
                    const [target, action] = argv[i].split(':');
                    if (target === 'qt' || target === 'sdk') {
                        items.push({ target, action: action || 'build' });
                    }
                }
                const result = runUseRemoteBuildOrder(workspace, {
                    action: hasFlag(argv, '--clear') ? 'clear' : 'set',
                    items: items.length > 0 ? items : undefined,
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
                    useTarget: 'lang',
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
                const USE_SUBCOMMANDS = ['target', 'execution', 'sync', 'remote', 'qt', 'sdk', 'lang'];
                const keywordEntry = KEYWORD_SUGGESTIONS['use']?.[subCmd];
                const keywordHint = keywordEntry ? `${keywordEntry.hint} ${keywordEntry.params.map(p => `[${p}]`).join(' ')}` : undefined;
                const substringHint = suggestCorrection(subCmd, USE_SUBCOMMANDS);
                const fallbackHint = substringHint ? `forja use ${substringHint}` : undefined;
                const hint = keywordHint || fallbackHint;
                const msg = hint
                    ? `${T('idx.unknownUseSubcommand')}: ${subCmd}. ${T('idx.didYouMean')}: ${hint}?`
                    : `${T('idx.unknownUseSubcommand')}: ${subCmd}`;
                const nextActions = keywordEntry ? [keywordEntry.next] : (hint ? [hint] : ['forja use target', 'forja use execution', 'forja use remote']);
                outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: msg }], nextActions }, wantsJson);
                process.exitCode = 1;
                return;
            }
            // No subcommand — show help
            const result: ForjaJsonResult = {
                ok: true,
                action: 'use',
                diagnostics: [{ level: 'info', message: T('idx.useUsage') }],
                nextActions: [
                    'forja use target --project <path>',
                    'forja use target --mode <mode> --arch <arch>',
                    'forja use execution --local|--remote',
                    'forja use sync --server <name> --remote-path <path>',
                    'forja use remote --server <name>',
                    'forja use lang zh|en',
                ],
            };
            outputResult(result, wantsJson);
        }
    }
}

// ── Server ──

function handleServer(argv: string[], wantsJson: boolean, locale: Locale): void {
    const srvKnown = new Set(['--name','--host','--username','--port','--auth-mode','--private-key-path','--password','--strict-host-key-checking','--no-strict-host-key-checking']);
    const srvWithVal = new Set(['--name','--host','--username','--port','--auth-mode','--private-key-path','--password']);
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
                    nextAction: 'forja list servers',
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
                    nextAction: 'forja list servers',
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
                outputResult({ ok: false, action: 'server', serverAction: 'add', changed: [], diagnostics: [{ level: 'error', message: msg }], nextActions: hint ? [`forja server ${hint}`] : ['forja server add', 'forja server update', 'forja server remove'] }, wantsJson);
                process.exitCode = 1;
                return;
            }
            outputResult({
                ok: true,
                action: 'server',
                serverAction: 'add',
                changed: [],
                diagnostics: [{ level: 'info', message: T('idx.serverUsage') }],
                nextActions: [
                    'forja server add --name <name> --host <host> --username <name>',
                    'forja list servers',
                ],
            }, wantsJson);
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
            nextActions: buildHint ? [`forja build ${buildHint}`] : ['forja build', 'forja build fresh', 'forja build qmake', 'forja build rcc'],
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const result = await runBuild(workspace, buildAction, { plan: hasFlag(argv, '--plan'), json: wantsJson, project: extractFlag(argv, '--project') });
    outputBuildResult(result, wantsJson, locale);
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
        outputRunResult(result, wantsJson, locale);
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
    outputRunResult(result, wantsJson, locale);
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
    // runStop handles output directly via Qt pipeline
    await runStop(workspace, { json: wantsJson, locale });
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
    outputCleanResult(result, wantsJson, locale);
    if (!result.ok) { process.exitCode = 1; }
}

// ── Doctor ──

async function handleDoctor(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    // Check for unknown flags
    const doctorKnownFlags = new Set(['--fix', '--unlock', '--restore', '--reset', '--clean-untracked', '--remote', '--server', '--force', '--recursive', '--plan']);
    const doctorFlagsWithValues = new Set(['--server', '--unlock']);
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
    const syncUnknown = findUnknownFlags(argv, new Set(['--plan', '--yes', '--file', '--server', '--repo']), new Set(['--file', '--server', '--repo']));
    if (syncUnknown.length > 0) {
        outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: `${T('sync.unknownFlag')}: ${syncUnknown.join(', ')}` }], nextAction: 'forja sync' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    let syncAction: SyncAction = 'run';
    if (subArg === 'plan' || hasFlag(argv, '--plan')) { syncAction = 'plan'; }
    else if (subArg === 'status') { syncAction = 'status'; }
    else if (subArg === 'reset') { syncAction = 'reset'; }
    else if (subArg === 'transfer') { syncAction = 'transfer'; }
    else if (subArg !== '') {
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

    const files = extractAllFlags(argv, '--file');
    const syncOptions = {
        server: extractFlag(argv, '--server'),
        repo: extractFlag(argv, '--repo'),
        file: files.length > 0 ? files : undefined,
    };
    const fmt = (r: unknown) => formatSyncText(r as Parameters<typeof formatSyncText>[0], locale);

    // Dispatch to standalone action functions
    switch (syncAction) {
        case 'plan': {
            const result = await runSyncPlan(workspace, syncOptions);
            outputResult(result, wantsJson, fmt);
            return;
        }
        case 'status': {
            const result = runSyncStatus(workspace, syncOptions);
            outputResult(result, wantsJson, fmt);
            return;
        }
        case 'reset': {
            const result = runSyncReset(workspace);
            outputResult(result, wantsJson, fmt);
            return;
        }
        case 'transfer': {
            const result = await runSyncTransfer(workspace);
            outputResult(result, wantsJson, fmt);
            return;
        }
        case 'run': {
            // Interactive: plan → confirm → execute (no double-plan)
            if (!wantsJson && !hasFlag(argv, '--yes')) {
                const plan = await runSyncPlan(workspace, syncOptions);
                if (!plan.ok) { outputResult(plan, false, fmt); process.exitCode = 1; return; }
                const pendingCount = (plan.plan?.pending?.length ?? 0) + (plan.plan?.deleted?.length ?? 0);
                if (pendingCount === 0) { console.log(T('syncNothing')); return; }
                console.log(formatSyncText(plan as Parameters<typeof formatSyncText>[0], locale));
                console.log();
                const yes = await confirm(T('syncConfirm'), false);
                if (!yes) { console.log(T('syncCancelled')); process.exitCode = 1; return; }
            }
            const result = await runSyncExecute(workspace, syncOptions);
            outputResult(result, wantsJson, fmt);
            return;
        }
    }
}
