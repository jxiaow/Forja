#!/usr/bin/env node
/**
 * Forja CLI — v2 entry point.
 * Routes to 11 top-level commands: status, init, list, use, server, build, run, stop, clean, doctor, sync.
 */

import { runCli } from './commands/index';
import { VERSION } from '../version';
import { setSilent } from '../core/loggerBase';
import { T, setGlobalLocale, resolveLocale } from './commands/types';
import { loadGlobalConfig } from '../core/settingsIO';

function printHelp(): void {
    console.log(`Forja v${VERSION}\n`);
    console.log(T('help.toplevel'));
}

async function main(argv: string[]): Promise<void> {
    if (argv.includes('--json')) {
        setSilent(true);
    }

    // Load locale before help/version so translations work
    const globalConfig = loadGlobalConfig();
    const locale = resolveLocale(undefined, globalConfig.lang);
    setGlobalLocale(locale);

    const subcommand = argv[0];

    if (!subcommand || subcommand === '--help' || subcommand === '-h') {
        printHelp();
        return;
    }

    if (subcommand === '--version' || subcommand === '-v') {
        console.log(VERSION);
        return;
    }

    await runCli(argv);
}

void main(process.argv.slice(2));
