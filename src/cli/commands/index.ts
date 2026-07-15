/**
 * CLI entry — dispatches to 12 top-level commands.
 * Called by src/cli/index.ts.
 */
import * as path from 'path';
import * as fs from 'fs';
import { ForjaJsonResult } from './types';
import { runStatus, formatStatusText } from './status';
import { runList, ListCategory, EnvSubCategory, formatListText } from './list';
import { runUseTarget, runUseExecution, runUseLang, runUseShow, runSuppressWarnings, formatUseText } from './use';
import { runRemoteShow, runRemoteSet, runRemoteRestore, runRemoteReset, formatRemoteText } from './remote';
import { runServerAdd, runServerUpdate, runServerRemove, formatServerText } from './server';
import { runBuild, BuildAction, outputBuildResult } from './build';
import { runRun, outputRunResult } from './run';
import { runStop, outputStopResult } from './stop';
import { runClean, outputCleanResult } from './clean';
import { runDoctor, formatDoctorText } from './doctor';
import { runSyncPlan, runSyncExecute, runSyncReset, runSyncStatus, runSyncIgnoreList, runSyncIgnoreAdd, runSyncIgnoreRm, formatSyncText } from './sync';
import { runInit, formatInitText } from './init';
import { confirm, prompt, choose } from './prompt';
import { resolveLocale, Locale, T, setGlobalLocale, diag } from './types';
import { loadGlobalConfig } from '../../core/settingsIO';
import { readServers, addServer, getServerById, readProjectSyncConfig } from '../../core/serverStore';
import { resolveGitRoots } from '../../core/gitRepoResolver';
import { ClassifiedChanges, configureSyncSettings } from '../../sync/cli';

type Command = 'status' | 'list' | 'use' | 'remote' | 'server' | 'build' | 'run' | 'stop' | 'clean' | 'doctor' | 'sync' | 'init';

const COMMANDS: Command[] = ['status', 'list', 'use', 'remote', 'server', 'build', 'run', 'stop', 'clean', 'doctor', 'sync', 'init'];

export function isCommand(cmd: string): cmd is Command {
    return COMMANDS.includes(cmd as Command);
}

// Track --workspace value errors
let workspaceError: string | null = null;

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
        doctor: T('help.doctor'),
        sync: T('help.sync.actual'),
        init: T('help.init'),
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
        case 'list':
            return handleList(argv, workspace, wantsJson, locale);
        case 'use':
            return handleUse(argv, workspace, wantsJson, locale);
        case 'remote':
            return handleRemote(argv, workspace, wantsJson, locale);
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
        case 'init':
            return handleInit(argv, workspace, wantsJson, locale);
        default: {
            const KNOWN_COMMANDS = ['status', 'list', 'use', 'remote', 'server', 'build', 'run', 'stop', 'clean', 'doctor', 'sync', 'init'];
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
        'qt-path':   { hint: 'forja use target', params: ['--qt <path>'],                                                                       next: 'forja use target --qt <path>' },
        'server':    { hint: 'forja remote set', params: ['--server <name>'],                                                                        next: 'forja remote set --server <name>' },
        'lang':      { hint: 'forja use lang',   params: ['<zh|en>'],                                                                                next: 'forja use lang <zh|en>' },
        'execution': { hint: 'forja use execution', params: ['--local', '--remote'],                                                                 next: 'forja use execution --local' },
        'local':     { hint: 'forja use execution', params: ['--local'],                                                                             next: 'forja use execution --local' },
        'remote':    { hint: 'forja remote set', params: ['--server <name>'],                                                                        next: 'forja remote set --server <name>' },
        'sync':      { hint: 'forja sync',       params: ['--server <name>', '--remote-path <path>'],                                                next: 'forja sync' },
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
        try {
            console.log(textFormatter(result));
        } catch (e) {
            // Fallback: show raw diagnostics
            console.error('Format error:', e instanceof Error ? e.message : String(e));
            if (result.diagnostics) {
                for (const d of result.diagnostics) {
                    if (d) { console.error(d.message); }
                }
            }
        }
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

// ── Init ──

async function handleInit(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const initKnown = new Set(['--workroot', '--answers']);
    const initWithValue = new Set(['--workroot', '--answers']);
    const initUnknown = findUnknownFlags(argv, initKnown, initWithValue);
    if (initUnknown.length > 0) {
        outputResult({ ok: false, action: 'init', diagnostics: [{ level: 'error', message: unknownFlagsMessage(initUnknown, initKnown) }], nextAction: 'forja init' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const workrootFlag = extractFlag(argv, '--workroot');
    const answersFile = extractFlag(argv, '--answers');

    let answers: Record<string, string> | undefined;
    if (answersFile) {
        try {
            answers = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
        } catch {
            outputResult({ ok: false, action: 'init', diagnostics: [{ level: 'error', message: `Failed to read answers file: ${answersFile}` }] }, wantsJson);
            process.exitCode = 1;
            return;
        }
    }

    const result = await runInit(workspace, {
        workroot: workrootFlag,
        interactive: !wantsJson && !answers,
        json: wantsJson,
        answers,
    });
    outputResult(result, wantsJson, (r) => formatInitText(r as Parameters<typeof formatInitText>[0]));
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
    const validCategories = ['targets', 'env'];

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

async function handleUse(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const subCmd = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';

    // Per-subcommand flag validation
    switch (subCmd) {
        case 'target': {
            if (argv[2] === 'suppress-warnings') {
                const swKnown = new Set(['--add', '--rm']);
                const swUnknown = findUnknownFlags(argv.slice(2), swKnown, new Set<string>());
                if (swUnknown.length > 0) {
                    outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(swUnknown, swKnown) }], nextAction: 'forja use target suppress-warnings' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                const add = hasFlag(argv, '--add');
                const rm = hasFlag(argv, '--rm');
                const codes = argv.slice(3).filter(a => !a.startsWith('--'));
                const result = runSuppressWarnings(workspace, codes, add, rm);
                outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
                return;
            }
            const targetKnown = new Set(['--project', '--mode', '--arch', '--qt', '--vs', '--jom', '--reset']);
            const targetWithVal = new Set(['--project', '--mode', '--arch', '--qt', '--vs', '--jom']);
            const targetUnknown = findUnknownFlags(argv, targetKnown, targetWithVal);
            if (targetUnknown.length > 0) {
                outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(targetUnknown, targetKnown) }], nextAction: 'forja use target' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const result = await runUseTarget(workspace, {
                project: extractFlag(argv, '--project'),
                mode: extractFlag(argv, '--mode') as 'debug' | 'release' | undefined,
                arch: extractFlag(argv, '--arch') as 'x86' | 'x64' | undefined,
                qtPath: extractFlag(argv, '--qt'),
                vsInstall: extractFlag(argv, '--vs'),
                jomPath: extractFlag(argv, '--jom'),
                reset: hasFlag(argv, '--reset'),
                interactive: !wantsJson,
                json: wantsJson,
            });
            outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
            return;
        }
        case 'execution': {
            const execKnown = new Set(['--local', '--remote']);
            const execUnknown = findUnknownFlags(argv, execKnown, new Set<string>());
            if (execUnknown.length > 0) {
                outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(execUnknown, execKnown) }], nextAction: 'forja use execution' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const result = runUseExecution(workspace, hasFlag(argv, '--local'), hasFlag(argv, '--remote'));
            outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
            return;
        }
        case 'lang': {
            const langUnknown = findUnknownFlags(argv.slice(1), new Set<string>(), new Set<string>());
            if (langUnknown.length > 0) {
                outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(langUnknown, new Set()) }], nextAction: 'forja use lang <zh|en>' }, wantsJson);
                process.exitCode = 1;
                return;
            }
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
                const USE_SUBCOMMANDS = ['target', 'execution', 'lang'];
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
            // No subcommand — show current config
            const showUnknown = findUnknownFlags(argv, new Set<string>(), new Set<string>());
            if (showUnknown.length > 0) {
                outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(showUnknown, new Set()) }], nextAction: 'forja use' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const result = runUseShow(workspace);
            outputResult(result, wantsJson, (r) => formatUseText(r as Parameters<typeof formatUseText>[0], locale));
        }
    }
}

// ── Remote ──

async function handleRemote(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const remoteKnown = new Set(['--server', '--remote-path']);
    const remoteWithVal = new Set(['--server', '--remote-path']);
    const remoteUnknown = findUnknownFlags(argv, remoteKnown, remoteWithVal);
    if (remoteUnknown.length > 0) {
        outputResult({ ok: false, action: 'remote', diagnostics: [{ level: 'error', message: unknownFlagsMessage(remoteUnknown, remoteKnown) }], nextAction: 'forja remote' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const fmt = (r: unknown) => formatRemoteText(r as Parameters<typeof formatRemoteText>[0], locale);
    const subCmd = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';

    switch (subCmd) {
        case 'restore': {
            const repo = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
            const paths: string[] = [];
            for (let i = 3; i < argv.length; i++) {
                if (!argv[i].startsWith('--')) { paths.push(argv[i]); }
            }
            if (!repo || paths.length === 0) {
                outputResult({
                    ok: false, action: 'remote', remoteAction: 'restore', changed: [],
                    diagnostics: [{ level: 'error', message: T('remote.restoreUsage') }],
                    nextAction: 'forja remote restore <repo> <paths...>',
                }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const result = await runRemoteRestore(workspace, { repo, paths, server: extractFlag(argv, '--server') });
            outputResult(result, wantsJson, fmt);
            return;
        }
        case 'reset': {
            const resetKnown = new Set(['--all', '--server']);
            const resetWithVal = new Set(['--server']);
            const resetUnknown = findUnknownFlags(argv.slice(1), resetKnown, resetWithVal);
            if (resetUnknown.length > 0) {
                outputResult({ ok: false, action: 'remote', remoteAction: 'reset', changed: [], diagnostics: [{ level: 'error', message: unknownFlagsMessage(resetUnknown, resetKnown) }], nextAction: 'forja remote reset' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const repo = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
            const paths: string[] = [];
            for (let i = 3; i < argv.length; i++) {
                if (!argv[i].startsWith('--')) { paths.push(argv[i]); }
            }
            if (!repo || paths.length === 0) {
                outputResult({
                    ok: false, action: 'remote', remoteAction: 'reset', changed: [],
                    diagnostics: [{ level: 'error', message: T('remote.resetUsage') }],
                    nextAction: 'forja remote reset <repo> <paths...>',
                }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const result = await runRemoteReset(workspace, { repo, paths, all: hasFlag(argv, '--all'), server: extractFlag(argv, '--server') });
            outputResult(result, wantsJson, fmt);
            return;
        }
        default: {
            if (subCmd !== '') {
                const REMOTE_SUBCOMMANDS = ['set', 'restore', 'reset'];
                const hint = suggestCorrection(subCmd, REMOTE_SUBCOMMANDS);
                const msg = hint
                    ? `${T('idx.unknownRemoteSubcommand')}: ${subCmd}. ${T('idx.didYouMean')}: ${hint}?`
                    : `${T('idx.unknownRemoteSubcommand')}: ${subCmd}`;
                outputResult({ ok: false, action: 'remote', remoteAction: 'show', changed: [], diagnostics: [{ level: 'error', message: msg }], nextAction: hint ? `forja remote ${hint}` : 'forja remote' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            // No subcommand: show current remote config
            // --server is only meaningful for set/restore/reset, reject in show mode
            const serverFlag = extractFlag(argv, '--server');
            const remotePathFlag = extractFlag(argv, '--remote-path');
            if (serverFlag || remotePathFlag) {
                outputResult({
                    ok: false, action: 'remote', remoteAction: 'show', changed: [],
                    diagnostics: [{ level: 'error', message: T('remote.showNoFlags') }],
                    nextAction: 'forja remote set --server <name>',
                }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const result = runRemoteShow(workspace);
            outputResult(result, wantsJson, fmt);
            return;
        }
        case 'set': {
            const result = runRemoteSet(workspace, {
                server: extractFlag(argv, '--server'),
                remotePath: extractFlag(argv, '--remote-path'),
            });
            outputResult(result, wantsJson, fmt);
            return;
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
                    diagnostics: [{ level: 'error', message:`${T('idx.serverIdRequired')}: forja server update <id>` }],
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
                    diagnostics: [{ level: 'error', message:`${T('idx.serverIdRequired')}: forja server remove <id>` }],
                    nextAction: 'forja server',
                }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const result = runServerRemove(id, workspace);
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
    const runUnknown = findUnknownFlags(argv, new Set(['--detach', '--plan']), new Set());
    if (runUnknown.length > 0) {
        outputResult({ ok: false, action: 'run', diagnostics: [{ level: 'error', message: unknownFlagsMessage(runUnknown, new Set(['--detach','--plan'])) }], nextAction: 'forja run' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';

    // Subcommands: designer, custom
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

    if (subArg === 'custom') {
        const customName = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
        if (!customName) {
            outputResult({
                ok: false,
                action: 'run',
                runAction: 'custom',
                diagnostics: [{ level: 'error', message: 'forja run custom requires <name>' }],
                nextAction: 'forja run custom <name>',
            }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const result = await runRun(workspace, { custom: customName, json: wantsJson });
        outputRunResult(result, wantsJson);
        if (!result.ok) { process.exitCode = 1; }
        return;
    }

    // Unknown positional arg
    if (subArg !== '') {
        const RUN_SUBCOMMANDS = ['designer', 'custom'];
        const hint = suggestCorrection(subArg, RUN_SUBCOMMANDS);
        const msg = hint
            ? `${T('idx.unknownArgument')}: ${subArg}. ${T('idx.didYouMean')}: forja run ${hint}?`
            : `${T('idx.unknownArgument')}: ${subArg}`;
        outputResult({
            ok: false, action: 'run', runAction: 'default', workspace,
            diagnostics: [{ level: 'error', message: msg }],
            nextAction: hint ? `forja run ${hint}` : 'forja run',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const result = await runRun(workspace, {
        detach: hasFlag(argv, '--detach'),
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
    const doctorKnownFlags = new Set(['--remote', '--server', '--plan']);
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

    if (subArg === 'fix') { fix = true; }
    else if (subArg === 'unlock') {
        unlockId = argv[2] && !argv[2].startsWith('--') ? argv[2] : undefined;
    }

    const result = await runDoctor(workspace, {
        remote: hasFlag(argv, '--remote'),
        server: extractFlag(argv, '--server'),
        fix,
        unlock: unlockId,
        plan: hasFlag(argv, '--plan'),
    });
    outputResult(result, wantsJson, (r) => formatDoctorText(r as Parameters<typeof formatDoctorText>[0], locale));
}

/**
 * Interactive sync setup — guides user to select/create server and input remote path.
 * Returns true if configuration was completed successfully.
 */
async function interactiveSyncSetup(workspace: string): Promise<{ ok: true } | { ok: false; reason: 'cancelled' | 'configError'; error?: string }> {
    const existingServers = readServers();
    let serverId: string | undefined;
    let selectedServer: { username: string } | undefined;

    if (existingServers.length === 0) {
        // No servers — guide creation
        console.log(T('sync.notConfigured'));
        const host = await prompt(T('setupPromptHost'));
        if (!host) return { ok: false, reason: 'cancelled' };
        const username = await prompt(T('setupPromptUsername'));
        if (!username) return { ok: false, reason: 'cancelled' };
        const portStr = await prompt(T('setupPromptPort'), '22');
        const port = parseInt(portStr || '22', 10);
        if (isNaN(port) || port < 1 || port > 65535) return { ok: false, reason: 'cancelled' };
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
            return { ok: false, reason: 'cancelled' };
        }
    } else if (existingServers.length === 1) {
        // Single server — auto-select
        serverId = existingServers[0].id;
        selectedServer = existingServers[0];
    } else {
        // Multiple servers — interactive selection
        const server = await choose(T('setupSelectServer'), existingServers, s => `${s.name} (${s.username}@${s.host})`);
        if (!server) return { ok: false, reason: 'cancelled' };
        serverId = server.id;
        selectedServer = server;
    }

    // Remote path: reuse existing or prompt
    const syncCfg = readProjectSyncConfig(workspace);
    let remotePath = syncCfg.remotePaths[serverId || ''] || '';
    if (!remotePath) {
        const defaultPath = `/home/${selectedServer?.username || 'user'}/${path.basename(workspace)}`;
        remotePath = await prompt(T('setupRemotePathPrompt'), defaultPath);
        if (!remotePath) return { ok: false, reason: 'cancelled' };
    }

    const cfg = configureSyncSettings(workspace, { serverId: serverId!, remotePath, enable: true });
    if (!cfg.ok) {
        return { ok: false, reason: 'configError', error: cfg.error || 'Failed to configure sync settings' };
    }

    console.log();
    return { ok: true };
}

// ── Sync ──

async function handleSync(argv: string[], workspace: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const syncUnknown = findUnknownFlags(argv, new Set(['--yes', '--file']), new Set(['--file']));
    if (syncUnknown.length > 0) {
        outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: `${T('sync.unknownFlag')}: ${syncUnknown.join(', ')}` }], nextAction: 'forja sync' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const fmt = (r: unknown) => formatSyncText(r as Parameters<typeof formatSyncText>[0], locale);
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    const files = extractAllFlags(argv, '--file');

    // ── 子命令校验 ──
    if (subArg !== '' && subArg !== 'plan' && subArg !== 'status' && subArg !== 'reset' && subArg !== 'ignore') {
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

    // reset subcommand: clear sync state
    if (subArg === 'reset') {
        const result = runSyncReset(workspace);
        outputResult(result, wantsJson, fmt);
        return;
    }

    // status: 显示配置，不需要 sync 前置配置
    if (subArg === 'status') {
        const result = runSyncStatus(workspace);
        outputResult(result, wantsJson, fmt);
        return;
    }

    // ignore: 管理忽略规则，不需要 sync 前置配置
    if (subArg === 'ignore') {
        const ignoreSub = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
        if (ignoreSub === '' ) {
            outputResult(runSyncIgnoreList(workspace), wantsJson, fmt);
        } else if (ignoreSub === 'add') {
            const pattern = argv[3];
            if (!pattern || pattern.startsWith('--')) {
                outputResult({ ok: false, action: 'sync', syncAction: 'ignore', ignoreAction: 'add', workspace, diagnostics: [diag('error', T('syncIgnorePatternRequired'))] }, wantsJson, fmt);
                process.exitCode = 1;
            } else {
                const result = runSyncIgnoreAdd(workspace, pattern);
                outputResult(result, wantsJson, fmt);
                if (!result.ok) process.exitCode = 1;
            }
        } else if (ignoreSub === 'rm') {
            const pattern = argv[3];
            if (!pattern || pattern.startsWith('--')) {
                outputResult({ ok: false, action: 'sync', syncAction: 'ignore', ignoreAction: 'rm', workspace, diagnostics: [diag('error', T('syncIgnorePatternRequired'))] }, wantsJson, fmt);
                process.exitCode = 1;
            } else {
                const result = runSyncIgnoreRm(workspace, pattern);
                outputResult(result, wantsJson, fmt);
                if (!result.ok) process.exitCode = 1;
            }
        } else {
            outputResult({ ok: false, action: 'sync', syncAction: 'ignore', workspace, diagnostics: [diag('error', `${T('sync.unknownAction')}: ${ignoreSub}`)], nextAction: 'forja sync ignore' }, wantsJson, fmt);
            process.exitCode = 1;
        }
        return;
    }

    // ── 检查配置是否完整 ──
    const syncCfg = readProjectSyncConfig(workspace);
    const serverExists = syncCfg.selectedServer ? readServers().some(s => s.id === syncCfg.selectedServer) : false;
    const needsSetup = !syncCfg.enabled || !syncCfg.selectedServer || !serverExists || !syncCfg.remotePaths[syncCfg.selectedServer];
    if (needsSetup) {
        if (wantsJson) {
            // JSON mode: return choices for AI to guide user
            outputResult({
                ok: false, action: 'sync',
                diagnostics: [{ level: 'error', message: T('sync.notConfigured') }],
                choices: [
                    { label: 'forja sync', command: 'forja sync', description: T('syncInteractiveSetup') },
                    { label: 'forja remote set', command: 'forja remote set', description: T('statusSetupRemote') },
                ],
            }, wantsJson);
            process.exitCode = 1;
            return;
        } else {
            // Text mode: interactive setup
            const guided = await interactiveSyncSetup(workspace);
            if (!guided.ok) {
                const msg = guided.reason === 'configError'
                    ? (guided.error || 'Failed to configure sync settings')
                    : T('syncCancelled');
                outputResult({
                    ok: false, action: 'sync',
                    diagnostics: [{ level: 'error', message: msg }],
                    nextAction: 'forja sync',
                }, wantsJson);
                process.exitCode = 1;
                return;
            }
            // Config is now complete, fall through to sync execution
        }
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
