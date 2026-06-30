#!/usr/bin/env node
/**
 * Forja CLI — v2 entry point.
 * Routes to 11 top-level commands: status, init, list, use, server, build, run, stop, clean, doctor, sync.
 */

import { runCli } from './commands/index';
import { VERSION } from '../version';
import { setSilent } from '../core/loggerBase';

function printHelp(): void {
    const help = `
Forja v${VERSION}

Usage:
  forja <command> [action] [options]

Commands:
  status    Current status and next steps
  setup     One-stop initialization (local + remote)
  list      List targets, servers, env, remote, config
  use       Select target, build config, execution endpoint
  server    Manage shared SSH servers (add/update/remove)
  build     Build current target
  run       Run current target
  stop      Stop running target
  clean     Clean build artifacts
  doctor    Deep diagnostics and recovery
  sync      Sync changed files to remote

Global options:
  --help, -h       Show help
  --version, -v    Show version
  --json           JSON output
  --workspace <p>  Specify workspace (default: cwd)

Examples:
  forja status --json
  forja setup --json
  forja list targets --json
  forja use target --project app/app.pro --json
  forja build --json
`.trim();
    console.log(help);
}

async function main(argv: string[]): Promise<void> {
    if (argv.includes('--json')) {
        setSilent(true);
    }

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
