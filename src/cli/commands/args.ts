/**
 * CLI argument parsing/validation helpers shared by command handlers.
 * Extracted from index.ts; behavior unchanged.
 */
import * as path from 'path';
import { T } from './types';

// ── Argument helpers ──

export function extractWorkspace(argv: string[]): { cwd: string; error?: string } {
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

export function extractFlag(argv: string[], flag: string, options: { allowEmpty?: boolean; allowOptionLikeValue?: boolean } = {}): string | undefined {
    const idx = argv.indexOf(flag);
    if (idx < 0 || idx + 1 >= argv.length) return undefined;
    const value = argv[idx + 1];
    if (!options.allowEmpty && value === '') return undefined;
    if (!options.allowOptionLikeValue && value.startsWith('--')) return undefined;
    return value;
}

/** Check if a flag was provided with an empty value (e.g., --flag "") */
export function hasEmptyFlagValue(argv: string[], flag: string): boolean {
    const idx = argv.indexOf(flag);
    if (idx < 0) return false;
    const next = argv[idx + 1];
    return !next || next.startsWith('--') || next === '';
}

export function hasFlag(argv: string[], flag: string): boolean {
    return argv.includes(flag);
}

// Known global flags that are valid for any command
const GLOBAL_FLAGS = new Set(['--json', '--workspace', '--lang', '--help', '-h']);

/**
 * Suggest a correction when user input doesn't match any valid option.
 * Uses substring matching: if the input contains a keyword that appears in a valid option,
 * or a valid option contains the input as a substring, return the best match.
 */
export function suggestCorrection(input: string, candidates: string[]): string | undefined {
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
export const KEYWORD_SUGGESTIONS: Record<string, Record<string, { hint: string; params: string[]; next: string }>> = {
    use: {
        'mode':      { hint: 'forja use target', params: ['--mode <debug|release>', '--arch <x86|x64>', '--project <path>'],                         next: 'forja use target --mode <debug|release>' },
        'arch':      { hint: 'forja use target', params: ['--arch <x86|x64>', '--mode <debug|release>', '--project <path>'],                         next: 'forja use target --arch <x86|x64>' },
        'project':   { hint: 'forja use target', params: ['--project <path>', '--mode <debug|release>', '--arch <x86|x64>'],                         next: 'forja use target --project <path>' },
        'qt-path':   { hint: 'forja use target', params: ['--qt <path>'],                                                                       next: 'forja use target --qt <path>' },
        'server':    { hint: 'forja sync', params: ['--server <name>', '--remote-path <path>'],                                               next: 'forja sync --server <name> --remote-path <path>' },
        'lang':      { hint: 'forja init --lang',   params: ['<zh|en>'],                                                                             next: 'forja init --lang <zh|en>' },
        'remote':    { hint: 'forja remote bootstrap', params: [],                                                                                   next: 'forja remote bootstrap' },
        'sync':      { hint: 'forja sync',       params: ['--server <name>', '--remote-path <path>'],                                                next: 'forja sync' },
    },
};

/**
 * Build an "unknown flags" error message with suggestions for close matches.
 */
export function unknownFlagsMessage(unknown: string[], knownFlags: Set<string>): string {
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
export function findUnknownFlags(
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

export function extractAllFlags(argv: string[], flag: string): string[] {
    const values: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === flag && argv[i + 1] && !argv[i + 1].startsWith('--')) {
            values.push(argv[i + 1]);
            i++;
        }
    }
    return values;
}
