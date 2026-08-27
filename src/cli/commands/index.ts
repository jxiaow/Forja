/**
 * CLI entry — dispatches to 11 top-level commands.
 * Called by src/cli/index.ts.
 */
import * as path from 'path';
import * as fs from 'fs';
import { ForjaJsonResult } from './types';
import { runStatus, formatStatusText } from './status';
import { runList, ListCategory, EnvSubCategory, formatListText } from './list';
import { runUseTarget, runUseShow, runSuppressWarnings, runRemoveTarget, formatUseText } from './use';
import { runRemoteShow, runRemoteSetup, formatRemoteText, RemoteResult } from './remote';
import { runServerAdd, runServerUpdate, runServerRemove, formatServerText } from './server';
import { runBuild, BuildAction, outputBuildResult } from './build';
import { runRun, outputRunResult } from './run';
import { runStop, outputStopResult } from './stop';
import { runClean, outputCleanResult } from './clean';
import { runSyncPlan, runSyncExecute, runSyncReset, runSyncStatus, runSyncIgnoreList, runSyncIgnoreAdd, runSyncIgnoreRm, formatSyncText, SyncResult, interactiveRemoteSetup } from './sync';
import { runInit, formatInitText } from './init';
import { confirm } from './prompt';
import { resolveLocale, Locale, T, setGlobalLocale, diag } from './types';
import { loadGlobalConfig, saveGlobalConfig, loadRemoteSettings } from '../../core/settingsIO';
import { readServers, readProjectSyncConfig } from '../../core/serverStore';
import { resolveGitRoots } from '../../core/gitRepoResolver';
import { resolveWorkroot, loadWorkspaceConfig } from '../../core/workspaceStore';
import { ClassifiedChanges } from '../../sync/cli';
import { runRemoteCli } from '../../remote/cli';

type Command = 'status' | 'list' | 'use' | 'remote' | 'server' | 'build' | 'run' | 'stop' | 'clean' | 'sync' | 'init';

const COMMANDS: Command[] = ['status', 'list', 'use', 'remote', 'server', 'build', 'run', 'stop', 'clean', 'sync', 'init'];

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
        case 'init':
            return handleInit(argv, cwd, wantsJson, locale);
        default: {
            const KNOWN_COMMANDS = ['status', 'list', 'use', 'remote', 'server', 'build', 'run', 'stop', 'clean', 'sync', 'init'];
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

function extractWorkspace(argv: string[]): { cwd: string; error?: string } {
    const idx = argv.indexOf('--workspace');
    if (idx >= 0) {
        const next = argv[idx + 1];
        if (!next || next.startsWith('--')) {
            return { cwd: process.cwd(), error: T('workspaceRequiresValue') };
        }
        return { cwd: path.resolve(next) };
    }
    return { cwd: process.cwd() };
}

function extractFlag(argv: string[], flag: string, options: { allowEmpty?: boolean; allowOptionLikeValue?: boolean } = {}): string | undefined {
    const idx = argv.indexOf(flag);
    if (idx < 0 || idx + 1 >= argv.length) return undefined;
    const value = argv[idx + 1];
    if (!options.allowEmpty && value === '') return undefined;
    if (!options.allowOptionLikeValue && value.startsWith('--')) return undefined;
    return value;
}

/** Check if a flag was provided with an empty value (e.g., --flag "") */
function hasEmptyFlagValue(argv: string[], flag: string): boolean {
    const idx = argv.indexOf(flag);
    if (idx < 0) return false;
    const next = argv[idx + 1];
    return !next || next.startsWith('--') || next === '';
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
        'server':    { hint: 'forja remote setup', params: ['--server <name>', '--remote-path <path>'],                                               next: 'forja remote setup --server <name> --remote-path <path>' },
        'lang':      { hint: 'forja init --lang',   params: ['<zh|en>'],                                                                             next: 'forja init --lang <zh|en>' },
        'remote':    { hint: 'forja remote bootstrap', params: [],                                                                                   next: 'forja remote bootstrap' },
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
function findUnknownFlags(
    argv: string[],
    knownFlags: Set<string>,
    flagsWithValues: Set<string>,
    options: { allowEmptyValues?: Set<string>; allowOptionLikeValues?: Set<string> } = {},
): string[] {
    const unknown: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--')) { continue; }
        if (GLOBAL_FLAGS.has(arg)) { continue; }
        if (knownFlags.has(arg)) {
            if (flagsWithValues.has(arg)) {
                const next = argv[i + 1];
                const allowsEmpty = options.allowEmptyValues?.has(arg) ?? false;
                const allowsOptionLike = options.allowOptionLikeValues?.has(arg) ?? false;
                if (next === undefined || (!allowsEmpty && next === '') || (!allowsOptionLike && next.startsWith('--'))) {
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

function outputResult<T extends ForjaJsonResult>(result: T, wantsJson: boolean, textFormatter?: (r: T) => string): void {
    // JSON callers must receive a directly reusable JSON continuation command.
    if (wantsJson && result.nextAction && !/\s--json(?:\s|$)/.test(result.nextAction)) {
        result = { ...result, nextAction: `${result.nextAction} --json` };
    }
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
            console.error(T('formatError'), e instanceof Error ? e.message : String(e));
            if (result.diagnostics) {
                for (const d of result.diagnostics) {
                    if (d) { console.error(d.message); }
                }
            }
        }
    } else {
        const lines: string[] = [];
        if (!result.ok) {
            lines.push(T('error'));
        }
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                if (d) { lines.push(`  ${T(d.level)}: ${d.message}`); }
            }
        }
        if (result.nextAction) {
            lines.push('');
            lines.push(T('next'));
            const a = result.nextAction; lines.push(`  ${a}`);
        }
        console.log(lines.length > 0 ? lines.join('\n') : JSON.stringify(result, null, 2));
    }
    if (!result.ok) { process.exitCode = 1; }
}

// ── Status ──

function handleStatus(argv: string[], workroot: string, wantsJson: boolean, locale: Locale): void {
    const statusUnknown = findUnknownFlags(argv, new Set(), new Set());
    if (statusUnknown.length > 0) {
        outputResult({ ok: false, action: 'status', diagnostics: [{ level: 'error', message: unknownFlagsMessage(statusUnknown, new Set()) }], nextAction: 'forja status' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    const result = runStatus(workroot);
    outputResult(result, wantsJson, (r) => formatStatusText(r, locale));
}

// ── Init ──

async function handleInit(argv: string[], workroot: string, wantsJson: boolean, _locale: Locale): Promise<void> {
    const initKnown = new Set(['--workroot', '--answers', '--lang']);
    const initWithValue = new Set(['--workroot', '--answers', '--lang']);
    const initUnknown = findUnknownFlags(argv, initKnown, initWithValue);
    if (initUnknown.length > 0) {
        outputResult({ ok: false, action: 'init', diagnostics: [{ level: 'error', message: unknownFlagsMessage(initUnknown, initKnown) }], nextAction: 'forja init' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const workrootFlag = extractFlag(argv, '--workroot');
    const answersFile = extractFlag(argv, '--answers');
    const langFlag = extractFlag(argv, '--lang');

    // Validate --lang early
    if (langFlag && langFlag !== 'zh' && langFlag !== 'en') {
        outputResult({ ok: false, action: 'init', diagnostics: [{ level: 'error', message: `${T('use.invalidLanguage')}: ${langFlag}. ${T('use.useZhOrEn')}` }] }, wantsJson);
        process.exitCode = 1;
        return;
    }

    let answers: Record<string, string> | undefined;
    if (answersFile) {
        try {
            const parsed = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                outputResult({ ok: false, action: 'init', diagnostics: [{ level: 'error', message: `Answers file must contain a JSON object: ${answersFile}` }] }, wantsJson);
                process.exitCode = 1;
                return;
            }
            answers = parsed;
        } catch {
            outputResult({ ok: false, action: 'init', diagnostics: [{ level: 'error', message: `${T('initAnswersFileFailed', [answersFile])}` }] }, wantsJson);
            process.exitCode = 1;
            return;
        }
    }

    // In JSON mode, workroot is collected as the first init answer. Resolve it
    // before scanning, but keep it out of target configuration answers.
    const answerWorkroot = answers?.workroot;
    if (answers && answerWorkroot) {
        const { workroot: _ignoredWorkroot, ...targetAnswers } = answers;
        answers = Object.keys(targetAnswers).length > 0 ? targetAnswers : undefined;
    }
    const result = await runInit(workroot, {
        workroot: workrootFlag || answerWorkroot,
        interactive: !wantsJson && !answers,
        json: wantsJson,
        answers,
    });

    // Persist --lang if provided and init succeeded
    if (langFlag && result.ok) {
        try {
            saveGlobalConfig({ lang: langFlag });
        } catch (e) {
            outputResult({ ok: false, action: 'init', diagnostics: [{ level: 'error', message: `${T('use.failedToSaveLanguage')}: ${e instanceof Error ? e.message : String(e)}` }] }, wantsJson);
            process.exitCode = 1;
            return;
        }
    }

    outputResult(result, wantsJson, (r) => formatInitText(r));
}

// ── List ──

async function handleList(argv: string[], workroot: string, wantsJson: boolean, locale: Locale): Promise<void> {
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
            workroot,
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

    // Build known flags set based on category
    const listKnown = new Set<string>(['--all']);
    if (category === 'env') {
        listKnown.add('--qt');
        listKnown.add('--vs');
        listKnown.add('--jom');
        listKnown.add('--make');
    }
    const listUnknown = findUnknownFlags(argv, listKnown, new Set<string>());
    if (listUnknown.length > 0) {
        outputResult({ ok: false, action: 'list', diagnostics: [{ level: 'error', message: unknownFlagsMessage(listUnknown, listKnown) }], nextAction: 'forja list targets' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // Reject env filter flags when category is not 'env'
    if (category !== 'env') {
        const envFlags = ['--qt', '--vs', '--jom', '--make'];
        const leaked = envFlags.filter(f => hasFlag(argv, f));
        if (leaked.length > 0) {
            outputResult({ ok: false, action: 'list', diagnostics: [{ level: 'error', message: `${T('idx.envFlagsOnlyWithEnv')}: ${leaked.join(', ')}` }], nextAction: 'forja list env --qt' }, wantsJson);
            process.exitCode = 1;
            return;
        }
    }

    // Reject --all when category is not 'targets'
    if (category !== 'targets' && hasFlag(argv, '--all')) {
        outputResult({ ok: false, action: 'list', diagnostics: [{ level: 'error', message: T('idx.allOnlyWithTargets') }], nextAction: 'forja list targets --all' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // Parse env filter flags (e.g., `forja list env --qt`)
    let envSubCategory: EnvSubCategory | undefined;
    if (category === 'env') {
        const envFlags: Array<{ flag: string; sub: EnvSubCategory }> = [
            { flag: '--qt', sub: 'qt' }, { flag: '--vs', sub: 'vs' },
            { flag: '--jom', sub: 'jom' }, { flag: '--make', sub: 'make' },
        ];
        const active = envFlags.filter(e => hasFlag(argv, e.flag));
        if (active.length > 1) {
            outputResult({
                ok: false, action: 'list',
                diagnostics: [{ level: 'error', message: T('idx.envSingleFilterOnly') }],
                nextAction: 'forja list env --qt',
            }, wantsJson);
            process.exitCode = 1;
            return;
        }
        if (active.length === 1) { envSubCategory = active[0].sub; }
    }

    const result = await runList(workroot, category, { envSubCategory, savedOnly: !hasFlag(argv, '--all') });
    outputResult(result, wantsJson, (r) => formatListText(r, locale));
}

// ── Use ──

async function handleUse(argv: string[], workroot: string, wantsJson: boolean, locale: Locale): Promise<void> {
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
                const result = runSuppressWarnings(workroot, codes, add, rm);
                outputResult(result, wantsJson, (r) => formatUseText(r, locale));
                return;
            }
            if (argv[2] === 'remove') {
                const rmKnown = new Set(['--force']);
                const rmUnknown = findUnknownFlags(argv.slice(2), rmKnown, new Set<string>());
                if (rmUnknown.length > 0) {
                    outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'error', message: unknownFlagsMessage(rmUnknown, rmKnown) }], nextAction: 'forja use target remove' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                const wsConfig = loadWorkspaceConfig(workroot);
                const savedTargets = Object.values(wsConfig.targets);
                if (savedTargets.length === 0) {
                    outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'error', message: T('use.noTargetsToRemove') }], nextAction: 'forja init' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                let targetId = argv[3] && !argv[3].startsWith('--') ? argv[3] : '';
                if (!targetId) {
                    if (!wantsJson) {
                        const { chooseRequired } = await import('./prompt');
                        const chosen = await chooseRequired(
                            T('use.selectTarget'),
                            savedTargets,
                            t => `${t.id}  ${t.name}  [${t.kind}] ${t.mode}|${t.arch}`,
                        );
                        if (!chosen) {
                            outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'info', message: T('cancelled') }] }, wantsJson);
                            return;
                        }
                        targetId = chosen.id;
                    } else {
                        outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'error', message: `${T('use.targetNotFound')}: forja use target remove <id>` }], nextAction: 'forja list targets --json' }, wantsJson);
                        process.exitCode = 1;
                        return;
                    }
                }
                if (!wsConfig.targets[targetId]) {
                    outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'error', message: T('use.targetNotFound', [targetId]) }], nextAction: 'forja list targets' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                const forceFlag = hasFlag(argv, '--force');
                if (!wantsJson && !forceFlag) {
                    const yes = await confirm(T('confirmRemoveTarget', [targetId]), false);
                    if (!yes) {
                        outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'info', message: T('cancelled') }] }, wantsJson);
                        return;
                    }
                } else if (wantsJson && !forceFlag) {
                    outputResult({ ok: false, action: 'use', useScope: 'target', changed: [], diagnostics: [{ level: 'error', message: T('destructiveRequiresForce') }], nextAction: `forja use target remove ${targetId} --force` }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                const removeResult = runRemoveTarget(workroot, targetId);
                outputResult(removeResult, wantsJson, (r) => formatUseText(r, locale));
                return;
            }
            const targetKnown = new Set(['--project', '--answers', '--mode', '--arch', '--qt', '--vs', '--jom', '--executable-name', '--reset', '--build-script', '--rcc-project-path']);
            const targetWithVal = new Set(['--project', '--answers', '--mode', '--arch', '--qt', '--vs', '--jom', '--executable-name', '--build-script', '--rcc-project-path']);
            const targetUnknown = findUnknownFlags(argv, targetKnown, targetWithVal, {
                allowEmptyValues: new Set(['--build-script', '--executable-name']),
            });
            if (targetUnknown.length > 0) {
                outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(targetUnknown, targetKnown) }], nextAction: 'forja use target' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            // Check for empty flag values (--build-script allows empty to clear)
            const emptyFlags = ['--project', '--answers', '--mode', '--arch', '--qt', '--vs', '--jom'];
            for (const f of emptyFlags) {
                if (hasEmptyFlagValue(argv, f)) {
                    outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: `${f} requires a non-empty value` }], nextAction: 'forja use target' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
            }
            const result = await runUseTarget(workroot, {
                project: extractFlag(argv, '--project') || (argv[2] && !argv[2].startsWith('--') ? argv[2] : undefined),
                answers: extractFlag(argv, '--answers'),
                mode: extractFlag(argv, '--mode') as 'debug' | 'release' | undefined,
                arch: extractFlag(argv, '--arch') as 'x86' | 'x64' | undefined,
                qtPath: extractFlag(argv, '--qt'),
                vsInstall: extractFlag(argv, '--vs'),
                jomPath: extractFlag(argv, '--jom'),
                executableName: extractFlag(argv, '--executable-name', { allowEmpty: true }),
                buildScript: extractFlag(argv, '--build-script', { allowEmpty: true }),
                rccProjectPath: extractFlag(argv, '--rcc-project-path'),
                reset: hasFlag(argv, '--reset'),
                interactive: !wantsJson,
                json: wantsJson,
            });
            outputResult(result, wantsJson, (r) => formatUseText(r, locale));
            return;
        }
        default: {
            if (subCmd !== '') {
                const USE_SUBCOMMANDS = ['target'];
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
            // No subcommand — handle global flags or show current config
            const globalKnown = new Set(['--jobs']);
            const globalWithVal = new Set(['--jobs']);
            const showUnknown = findUnknownFlags(argv, globalKnown, globalWithVal, {
                allowEmptyValues: new Set(['--jobs']),
            });
            if (showUnknown.length > 0) {
                outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: unknownFlagsMessage(showUnknown, globalKnown) }], nextAction: 'forja use' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            // --jobs: persist global parallel build setting
            const jobsRaw = extractFlag(argv, '--jobs', { allowEmpty: true });
            if (jobsRaw !== undefined) {
                if (jobsRaw === '') {
                    saveGlobalConfig({ jobs: undefined });
                    outputResult({ ok: true, action: 'use', useScope: 'global', changed: ['jobs'], nextAction: 'forja build' }, wantsJson, (r) => T('use.jobsCleared'));
                    return;
                }
                const jobsNum = parseInt(jobsRaw, 10);
                if (isNaN(jobsNum) || jobsNum < 1) {
                    outputResult({ ok: false, action: 'use', diagnostics: [{ level: 'error', message: T('use.jobsRequiresPositive') }], nextAction: 'forja use --jobs <N>' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                saveGlobalConfig({ jobs: jobsNum });
                outputResult({ ok: true, action: 'use', useScope: 'global', changed: ['jobs'], jobs: jobsNum, nextAction: 'forja build' }, wantsJson, (r) => T('use.jobsSet', [String(jobsNum)]));
                return;
            }
            const result = runUseShow(workroot);
            outputResult(result, wantsJson, (r) => formatUseText(r, locale));
        }
    }
}

// ── Remote ──

async function handleRemote(argv: string[], workroot: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const subCmd = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    const remoteKnown = new Set(['--server', '--remote-path', ...((subCmd === 'bootstrap' || subCmd === 'setup') ? ['--force'] : [])]);
    const remoteWithVal = new Set(['--server', '--remote-path']);
    const remoteUnknown = findUnknownFlags(argv, remoteKnown, remoteWithVal);
    if (remoteUnknown.length > 0) {
        outputResult({ ok: false, action: 'remote', diagnostics: [{ level: 'error', message: unknownFlagsMessage(remoteUnknown, remoteKnown) }], nextAction: 'forja remote' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const fmt = (r: RemoteResult) => formatRemoteText(r, locale);
    switch (subCmd) {
        case 'bootstrap': {
            await runRemoteCli(['bootstrap', '--workspace', workroot, ...(hasFlag(argv, '--force') ? ['--force'] : []), ...(wantsJson ? ['--json'] : [])]);
            return;
        }
        case 'setup': {
            const server = extractFlag(argv, '--server');
            const remotePath = extractFlag(argv, '--remote-path');
            if (wantsJson && (!server || !remotePath)) {
                outputResult({ ok: false, action: 'remote', remoteAction: 'setup', changed: [], diagnostics: [{ level: 'error', message: 'remote setup --json requires --server and --remote-path.' }], nextAction: 'forja remote setup --server <name> --remote-path <path>' }, true);
                process.exitCode = 1;
                return;
            }
            if (server || remotePath) {
                if (!server || !remotePath) {
                    outputResult({ ok: false, action: 'remote', remoteAction: 'setup', changed: [], diagnostics: [{ level: 'error', message: 'remote setup requires both --server and --remote-path.' }], nextAction: 'forja remote setup --server <name> --remote-path <path>' }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
                const result = runRemoteSetup(workroot, { server, remotePath });
                if (!result.ok) { outputResult(result, wantsJson, fmt); process.exitCode = 1; return; }
            } else {
                const result = await interactiveRemoteSetup(workroot);
                if (!result.ok) { outputResult({ ok: false, action: 'remote', remoteAction: 'setup', changed: [], diagnostics: [{ level: 'error', message: result.error || T('syncCancelled') }] }, false); process.exitCode = 1; return; }
            }
            await runRemoteCli(['bootstrap', '--workspace', workroot, ...(hasFlag(argv, '--force') ? ['--force'] : []), ...(wantsJson ? ['--json'] : [])]);
            return;
        }
        default: {
            if (subCmd !== '') {
                const REMOTE_SUBCOMMANDS = ['setup', 'bootstrap'];
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
                    nextAction: 'forja remote setup --server <name> --remote-path <path>',
                }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const result = runRemoteShow(workroot);
            outputResult(result, wantsJson, fmt);
            return;
        }
    }
}

// ── Server ──

async function handleServer(argv: string[], workroot: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const subCmd = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';

    // Per-subcommand flag validation — each subcommand only accepts its own flags
    const srvWithVal = new Set(['--name','--host','--username','--port','--auth-mode','--private-key-path','--password']);
    const addUpdateKnown = new Set(['--name','--host','--username','--port','--auth-mode','--private-key-path','--password','--strict-host-key-checking','--no-strict-host-key-checking']);
    const removeKnown = new Set(['--force']);
    const listKnown = new Set(['--detail']);
    const strictHostKeyChecking = hasFlag(argv, '--strict-host-key-checking');
    const noStrictHostKeyChecking = hasFlag(argv, '--no-strict-host-key-checking');

    if ((subCmd === 'add' || subCmd === 'update') && strictHostKeyChecking && noStrictHostKeyChecking) {
        outputResult({
            ok: false,
            action: 'server',
            serverAction: subCmd,
            changed: [],
            diagnostics: [{ level: 'error', message: T('srv.strictHostFlagsConflict') }],
            nextAction: `forja server ${subCmd}`,
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    switch (subCmd) {
        case 'add': {
            const addUnknown = findUnknownFlags(argv, addUpdateKnown, srvWithVal);
            if (addUnknown.length > 0) {
                outputResult({ ok: false, action: 'server', serverAction: 'add', changed: [], diagnostics: [{ level: 'error', message: unknownFlagsMessage(addUnknown, addUpdateKnown) }], nextAction: 'forja server add' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const portStr = extractFlag(argv, '--port');
            let port: number | undefined;
            if (portStr) {
                // Reject non-integer values (e.g., "3.14", "abc")
                if (!/^\d+$/.test(portStr)) {
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
                strictHostKeyChecking: strictHostKeyChecking ? true : noStrictHostKeyChecking ? false : undefined,
            });
            outputResult(result, wantsJson, (r) => formatServerText(r, locale));
            return;
        }
        case 'update': {
            const updateUnknown = findUnknownFlags(argv, addUpdateKnown, srvWithVal);
            if (updateUnknown.length > 0) {
                outputResult({ ok: false, action: 'server', serverAction: 'update', changed: [], diagnostics: [{ level: 'error', message: unknownFlagsMessage(updateUnknown, addUpdateKnown) }], nextAction: 'forja server update' }, wantsJson);
                process.exitCode = 1;
                return;
            }
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
                // Reject non-integer values (e.g., "3.14", "abc")
                if (!/^\d+$/.test(portStr)) {
                    outputResult({
                        ok: false,
                        action: 'server',
                        serverAction: 'update',
                        changed: [],
                        diagnostics: [{
                            level: 'error',
                            message: `${T('idx.invalidPort')}: ${portStr}. ${T('idx.invalidPortHint')}`,
                        }],
                        nextAction: `forja server update ${id} --port 22`,
                    }, wantsJson);
                    process.exitCode = 1;
                    return;
                }
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
                        nextAction: `forja server update ${id} --port 22`,
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
                strictHostKeyChecking: strictHostKeyChecking ? true : noStrictHostKeyChecking ? false : undefined,
            });
            outputResult(result, wantsJson, (r) => formatServerText(r, locale));
            return;
        }
        case 'remove': {
            const removeUnknown = findUnknownFlags(argv, removeKnown, new Set());
            if (removeUnknown.length > 0) {
                outputResult({ ok: false, action: 'server', serverAction: 'remove', changed: [], diagnostics: [{ level: 'error', message: unknownFlagsMessage(removeUnknown, removeKnown) }], nextAction: 'forja server remove' }, wantsJson);
                process.exitCode = 1;
                return;
            }
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
            // Destructive action: require confirmation
            const forceFlag = hasFlag(argv, '--force');
            if (!wantsJson && !forceFlag) {
                const yes = await confirm(T('confirmRemoveServer', [id]), false);
                if (!yes) {
                    outputResult({ ok: false, action: 'server', serverAction: 'remove', changed: [], diagnostics: [{ level: 'info', message: T('cancelled') }] }, wantsJson);
                    return;
                }
            } else if (wantsJson && !forceFlag) {
                outputResult({ ok: false, action: 'server', serverAction: 'remove', changed: [], diagnostics: [{ level: 'error', message: T('destructiveRequiresForce') }], nextAction: `forja server remove ${id} --force` }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const result = runServerRemove(id, workroot);
            outputResult(result, wantsJson, (r) => formatServerText(r, locale));
            return;
        }
        default: {
            if (subCmd !== '') {
                const SERVER_SUBCOMMANDS = ['add', 'update', 'remove'];
                const hint = suggestCorrection(subCmd, SERVER_SUBCOMMANDS);
                const msg = hint
                    ? `${T('idx.unknownServerSubcommand')}: ${subCmd}. ${T('idx.didYouMean')}: ${hint}?`
                    : `${T('idx.unknownServerSubcommand')}: ${subCmd}`;
                outputResult({ ok: false, action: 'server', serverAction: 'list', changed: [], diagnostics: [{ level: 'error', message: msg }], nextAction: hint ? `forja server ${hint}` : 'forja server add' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const listUnknown = findUnknownFlags(argv, listKnown, new Set(['--detail']));
            if (listUnknown.length > 0) {
                outputResult({ ok: false, action: 'server', serverAction: 'list', changed: [], diagnostics: [{ level: 'error', message: unknownFlagsMessage(listUnknown, listKnown) }], nextAction: 'forja server' }, wantsJson);
                process.exitCode = 1;
                return;
            }
            const detailId = extractFlag(argv, '--detail');
            const result = await runList(workroot, 'servers', { detailId });
            outputResult(result, wantsJson, (r) => formatListText(r, locale));
        }
    }
}

// ── Build ──

async function handleBuild(argv: string[], workroot: string, wantsJson: boolean, _locale: Locale): Promise<void> {
    const buildUnknown = findUnknownFlags(
        argv,
        new Set(['--plan', '--project', '--build-args', '--jobs']),
        new Set(['--project', '--build-args', '--jobs']),
        { allowOptionLikeValues: new Set(['--build-args']) },
    );
    if (buildUnknown.length > 0) {
        outputResult({ ok: false, action: 'build', buildAction: 'default', workroot, diagnostics: [{ level: 'error', message: unknownFlagsMessage(buildUnknown, new Set(['--plan','--project','--build-args','--jobs'])) }], nextAction: 'forja build' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    if (hasEmptyFlagValue(argv, '--project')) {
        outputResult({ ok: false, action: 'build', buildAction: 'default', workroot, diagnostics: [{ level: 'error', message: '--project requires a non-empty value' }], nextAction: 'forja build' }, wantsJson);
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
            workroot,
            diagnostics: [{ level: 'error', message: buildMsg }],
            nextAction: buildHint ? `forja build ${buildHint}` : 'forja build',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const jobsRaw = extractFlag(argv, '--jobs');
    let jobs: number | undefined;
    if (jobsRaw) {
        jobs = parseInt(jobsRaw, 10);
        if (isNaN(jobs) || jobs < 1) {
            outputResult({ ok: false, action: 'build', buildAction: 'default', workroot, diagnostics: [{ level: 'error', message: '--jobs requires a positive integer' }], nextAction: 'forja build' }, wantsJson);
            process.exitCode = 1;
            return;
        }
    } else {
        jobs = loadGlobalConfig().jobs;
    }

    const result = await runBuild(workroot, buildAction, {
        plan: hasFlag(argv, '--plan'),
        json: wantsJson,
        project: extractFlag(argv, '--project'),
        buildArgs: extractFlag(argv, '--build-args', { allowOptionLikeValue: true }),
        jobs,
    });
    outputBuildResult(result, wantsJson);
}

// ── Run ──

async function handleRun(argv: string[], workroot: string, wantsJson: boolean, _locale: Locale): Promise<void> {
    const runUnknown = findUnknownFlags(argv, new Set(['--detach', '--plan', '--debug']), new Set());
    if (runUnknown.length > 0) {
        outputResult({ ok: false, action: 'run', diagnostics: [{ level: 'error', message: unknownFlagsMessage(runUnknown, new Set(['--detach','--plan','--debug'])) }], nextAction: 'forja run' }, wantsJson);
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
        const result = await runRun(workroot, { designer: uiFile, json: wantsJson });
        outputRunResult(result, wantsJson);
        return;
    }

    if (subArg === 'custom') {
        const customName = argv[2] && !argv[2].startsWith('--') ? argv[2] : '';
        if (!customName) {
            outputResult({
                ok: false,
                action: 'run',
                runAction: 'custom',
                diagnostics: [{ level: 'error', message: T('runCustomRequiresName') }],
                nextAction: 'forja run custom <name>',
            }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const result = await runRun(workroot, { custom: customName, json: wantsJson });
        outputRunResult(result, wantsJson);
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
            ok: false, action: 'run', runAction: 'default', workroot,
            diagnostics: [{ level: 'error', message: msg }],
            nextAction: hint ? `forja run ${hint}` : 'forja run',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const result = await runRun(workroot, {
        detach: hasFlag(argv, '--detach'),
        debug: hasFlag(argv, '--debug'),
        plan: hasFlag(argv, '--plan'),
        json: wantsJson,
    });
    outputRunResult(result, wantsJson);
}

// ── Stop ──

async function handleStop(argv: string[], workroot: string, wantsJson: boolean, _locale: Locale): Promise<void> {
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
    const result = await runStop(workroot, { json: wantsJson });
    outputStopResult(result, wantsJson);
}

// ── Clean ──

async function handleClean(argv: string[], workroot: string, wantsJson: boolean, _locale: Locale): Promise<void> {
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
    const result = await runClean(workroot, { plan: hasFlag(argv, '--plan'), json: wantsJson });
    outputCleanResult(result, wantsJson);
}

// ── Sync ──

async function handleSync(argv: string[], workroot: string, wantsJson: boolean, locale: Locale): Promise<void> {
    const syncUnknown = findUnknownFlags(argv, new Set(['--yes', '--file', '--force', '--dry-run', '--add', '--rm']), new Set(['--file', '--add', '--rm']));
    if (syncUnknown.length > 0) {
        outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: `${T('sync.unknownFlag')}: ${syncUnknown.join(', ')}` }], nextAction: 'forja sync' }, wantsJson);
        process.exitCode = 1;
        return;
    }
    if (hasEmptyFlagValue(argv, '--file')) {
        outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: '--file requires a non-empty value' }], nextAction: 'forja sync' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    const fmt = (r: SyncResult) => formatSyncText(r, locale);
    const subArg = argv[1] && !argv[1].startsWith('--') ? argv[1] : '';
    const files = extractAllFlags(argv, '--file');

    // ── 子命令校验 ──
    if (subArg !== '' && subArg !== 'status' && subArg !== 'reset' && subArg !== 'ignore') {
        outputResult({
            ok: false,
            action: 'sync',
            syncAction: 'run',
            workroot,
            diagnostics: [{
                level: 'error',
                message: `${T('sync.unknownAction')}: ${subArg}`,
            }],
            nextAction: 'forja sync',
        }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // X2: --file is only valid for default sync (execute/plan), not for subcommands
    if (files.length > 0 && subArg !== '') {
        outputResult({ ok: false, action: 'sync', syncAction: 'run', diagnostics: [{ level: 'error', message: T('sync.fileOnlyForExecute') }], nextAction: 'forja sync --file <path>' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // X3: --add/--rm are only valid for the ignore subcommand
    if (subArg !== 'ignore' && (hasFlag(argv, '--add') || hasFlag(argv, '--rm'))) {
        outputResult({ ok: false, action: 'sync', syncAction: 'ignore', diagnostics: [{ level: 'error', message: T('sync.ignoreFlagsOnlyWithIgnore') }], nextAction: 'forja sync ignore --add <pattern>' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // X1: --dry-run and --yes are mutually exclusive
    if (hasFlag(argv, '--dry-run') && hasFlag(argv, '--yes')) {
        outputResult({ ok: false, action: 'sync', syncAction: 'run', diagnostics: [{ level: 'error', message: T('sync.dryRunYesConflict') }], nextAction: 'forja sync' }, wantsJson);
        process.exitCode = 1;
        return;
    }

    // reset subcommand: clear sync state (destructive — requires confirmation)
    if (subArg === 'reset') {
        if (hasFlag(argv, '--dry-run')) {
            outputResult({ ok: false, action: 'sync', syncAction: 'reset', workroot, diagnostics: [{ level: 'error', message: T('sync.dryRunIncompatible') }], nextAction: 'forja sync reset' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const forceFlag = hasFlag(argv, '--force');
        if (!wantsJson && !forceFlag) {
            const yes = await confirm(T('syncResetConfirm'), false);
            if (!yes) {
                outputResult({ ok: false, action: 'sync', syncAction: 'reset', diagnostics: [{ level: 'info', message: T('cancelled') }] }, wantsJson);
                return;
            }
        } else if (wantsJson && !forceFlag) {
            outputResult({ ok: false, action: 'sync', syncAction: 'reset', diagnostics: [{ level: 'error', message: T('destructiveRequiresForce') }], nextAction: 'forja sync reset --force' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const result = runSyncReset(workroot);
        outputResult(result, wantsJson, fmt);
        return;
    }

    // status: 显示配置，不需要 sync 前置配置
    if (subArg === 'status') {
        if (hasFlag(argv, '--dry-run')) {
            outputResult({ ok: false, action: 'sync', syncAction: 'status', diagnostics: [{ level: 'error', message: T('sync.dryRunIncompatible') }], nextAction: 'forja sync status' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        const result = runSyncStatus(workroot);
        outputResult(result, wantsJson, fmt);
        return;
    }

    // ignore: 管理忽略规则，不需要 sync 前置配置
    if (subArg === 'ignore') {
        if (hasFlag(argv, '--dry-run')) {
            outputResult({ ok: false, action: 'sync', syncAction: 'ignore', diagnostics: [{ level: 'error', message: T('sync.dryRunIncompatible') }], nextAction: 'forja sync ignore' }, wantsJson);
            process.exitCode = 1;
            return;
        }
        if (hasFlag(argv, '--add') && hasFlag(argv, '--rm')) {
            outputResult({ ok: false, action: 'sync', syncAction: 'ignore', workroot, diagnostics: [diag('error', T('syncIgnoreAddRmConflict'))] }, wantsJson, fmt);
            process.exitCode = 1;
            return;
        }
        if (hasFlag(argv, '--add') || hasFlag(argv, '--rm')) {
            const hasAdd = hasFlag(argv, '--add');
            const hasRm = hasFlag(argv, '--rm');
            const addPattern = hasAdd ? extractFlag(argv, '--add') : undefined;
            const rmPattern = hasRm ? extractFlag(argv, '--rm') : undefined;
            if (hasAdd && !addPattern) {
                outputResult({ ok: false, action: 'sync', syncAction: 'ignore', ignoreAction: 'add', workroot, diagnostics: [diag('error', T('syncIgnorePatternRequired'))] }, wantsJson, fmt);
                process.exitCode = 1;
                return;
            }
            if (hasRm && !rmPattern) {
                outputResult({ ok: false, action: 'sync', syncAction: 'ignore', ignoreAction: 'rm', workroot, diagnostics: [diag('error', T('syncIgnorePatternRequired').replace('--add', '--rm'))] }, wantsJson, fmt);
                process.exitCode = 1;
                return;
            }
            if (addPattern) {
                const result = runSyncIgnoreAdd(workroot, addPattern);
                outputResult(result, wantsJson, fmt);
                if (!result.ok) process.exitCode = 1;
            } else if (rmPattern) {
                const result = runSyncIgnoreRm(workroot, rmPattern);
                outputResult(result, wantsJson, fmt);
                if (!result.ok) process.exitCode = 1;
            }
        } else {
            outputResult(runSyncIgnoreList(workroot), wantsJson, fmt);
        }
        return;
    }

    // ── 检查配置是否完整 ──
    const syncCfg = readProjectSyncConfig(workroot);
    const remoteCfg = loadRemoteSettings(workroot);
    const serverExists = remoteCfg.selectedServer ? readServers().some(s => s.id === remoteCfg.selectedServer) : false;
    const needsSetup = !syncCfg.enabled || !remoteCfg.selectedServer || !serverExists || !remoteCfg.remotePaths[remoteCfg.selectedServer];
    if (needsSetup) {
        if (wantsJson) {
            // JSON mode: return choices for AI to guide user
            outputResult({
                ok: false, action: 'sync',
                diagnostics: [{ level: 'error', message: T('sync.notConfigured') }],
                choices: [
                    { label: 'forja sync', command: 'forja sync', description: T('syncInteractiveSetup') },
                    { label: 'forja remote setup', command: 'forja remote setup', description: T('statusSetupRemote') },
                ],
            }, wantsJson);
            process.exitCode = 1;
            return;
        } else {
            outputResult({ ok: false, action: 'sync', diagnostics: [{ level: 'error', message: T('sync.notConfigured') }], nextAction: 'forja remote setup' }, false);
            process.exitCode = 1;
            return;
        }
    }

    if (hasFlag(argv, '--dry-run')) {
        const result = await runSyncPlan(workroot, files);
        outputResult(result, wantsJson, fmt);
        return;
    }

    // Default: interactive plan → confirm → execute
    if (!wantsJson && !hasFlag(argv, '--yes')) {
        const plan = await runSyncPlan(workroot, files);
        if (!plan.ok) { outputResult(plan, false, fmt); process.exitCode = 1; return; }
        const pendingCount = (plan.plan?.pending?.length ?? 0) + (plan.plan?.deleted?.length ?? 0);
        if (pendingCount === 0) { console.log(T('syncNothing')); return; }
        // 交互确认中的 plan 只是中间步骤，不显示 nextAction（用户已在 forja sync 流程中）
        plan.nextAction = undefined;
        console.log(formatSyncText(plan, locale));
        console.log();
        const yes = await confirm(T('syncConfirm'), false);
        if (!yes) { console.log(T('syncCancelled')); process.exitCode = 1; return; }

        // Reuse plan data to avoid re-running git status
        const gitRoots = resolveGitRoots(workroot);
        const classified: ClassifiedChanges = {
            pending: plan.plan?.pending ?? [],
            deleted: plan.plan?.deleted ?? [],
            skipped: plan.plan?.skipped ?? [],
            skippedDetails: plan.plan?.skippedDetails ?? [],
            gitRoots: (plan.plan?.repos ?? []).map(name => gitRoots.find(g => g.name === name)).filter(Boolean) as ReturnType<typeof resolveGitRoots>,
            requestedFilesNotFound: false,
        };
        const result = await runSyncExecute(workroot, files, classified);
        outputResult(result, wantsJson, fmt);
        return;
    }
    const result = await runSyncExecute(workroot, files);
    outputResult(result, wantsJson, fmt);
}
