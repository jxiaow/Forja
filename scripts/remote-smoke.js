#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function usage() {
    return [
        'Usage: node scripts/remote-smoke.js --target <qt|sdk|both> [options]',
        '',
        'Options:',
        '  --workspace <path>  Local workspace root. Defaults to cwd.',
        '  --target <target>   qt, sdk, or both. Defaults to both.',
        '  --build             Include remote build actions.',
        '  --bootstrap         Allow remote test --bootstrap before target checks.',
        '  --execute           Run commands. Without this flag the script prints a dry-run plan.',
        '  --yes               Required when executing --bootstrap or --build.',
        '  --cli <path>        Compiled CLI entry. Defaults to out/cli/index.js.',
        '  --json-dir <path>   Save stdout/stderr for each executed step.',
        '  --help              Show this help.'
    ].join('\n');
}

function parseArgs(argv) {
    const options = {
        workspace: process.cwd(),
        target: 'both',
        build: false,
        bootstrap: false,
        execute: false,
        yes: false,
        cli: path.join(repoRoot, 'out', 'cli', 'index.js'),
        jsonDir: ''
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--workspace':
                options.workspace = path.resolve(readValue(argv, ++i, arg));
                break;
            case '--target':
                options.target = readValue(argv, ++i, arg);
                break;
            case '--build':
                options.build = true;
                break;
            case '--bootstrap':
                options.bootstrap = true;
                break;
            case '--execute':
                options.execute = true;
                break;
            case '--yes':
                options.yes = true;
                break;
            case '--cli':
                options.cli = path.resolve(readValue(argv, ++i, arg));
                break;
            case '--json-dir':
                options.jsonDir = path.resolve(readValue(argv, ++i, arg));
                break;
            case '--help':
                console.log(usage());
                process.exit(0);
                break;
            default:
                throw new Error('Unknown option: ' + arg);
        }
    }

    if (!['qt', 'sdk', 'both'].includes(options.target)) {
        throw new Error('--target must be qt, sdk, or both');
    }
    if (options.execute && (options.bootstrap || options.build) && !options.yes) {
        throw new Error('--yes is required when executing --bootstrap or --build');
    }
    return options;
}

function readValue(argv, index, option) {
    const value = argv[index];
    if (!value || value.startsWith('--')) {
        throw new Error(option + ' requires a value');
    }
    return value;
}

function buildPlan(options) {
    const targets = options.target === 'both' ? ['qt', 'sdk'] : [options.target];
    const steps = [
        step('remote-status', ['remote', 'status', '--workspace', options.workspace, '--json']),
        step('remote-test', ['remote', 'test', '--workspace', options.workspace, '--json']),
        step('remote-build-order-status', ['remote', 'build-order', 'status', '--workspace', options.workspace, '--json']),
        step('remote-transfer-status', ['remote', 'transfer', 'status', '--workspace', options.workspace, '--json'])
    ];

    if (options.bootstrap) {
        steps.push(step('remote-test-bootstrap', ['remote', 'test', '--bootstrap', '--workspace', options.workspace, '--json'], true));
    }

    for (const target of targets) {
        steps.push(step(target + '-status', ['remote', target, 'status', '--workspace', options.workspace, '--json']));
        if (options.build) {
            steps.push(step(target + '-build', ['remote', target, 'build', '--workspace', options.workspace, '--json'], true));
        }
    }

    steps.push(step('remote-status-final', ['remote', 'status', '--workspace', options.workspace, '--json']));
    return steps;
}

function step(name, args, mutatesRemote = false) {
    return { name, args, mutatesRemote };
}

function printPlan(options, steps) {
    console.log('Remote smoke plan');
    console.log('workspace: ' + options.workspace);
    console.log('target: ' + options.target);
    console.log('mode: ' + (options.execute ? 'execute' : 'dry-run'));
    for (const item of steps) {
        const marker = item.mutatesRemote ? ' [mutates remote]' : '';
        console.log('- ' + item.name + marker + ': node ' + path.relative(process.cwd(), options.cli) + ' ' + item.args.join(' '));
    }
    if (!options.execute) {
        console.log('Dry-run only. Add --execute to run SSH-backed remote commands.');
    }
}

function runPlan(options, steps) {
    if (!fs.existsSync(options.cli)) {
        throw new Error('Compiled CLI not found at ' + options.cli + '. Run npm run compile first.');
    }
    if (options.jsonDir) {
        fs.mkdirSync(options.jsonDir, { recursive: true });
    }

    for (const item of steps) {
        const result = spawnSync(process.execPath, [options.cli, ...item.args], {
            cwd: repoRoot,
            encoding: 'utf8',
            env: process.env
        });
        writeStepOutput(options, item, result);
        if (result.stdout) {
            process.stdout.write(result.stdout);
            if (!result.stdout.endsWith('\n')) {
                process.stdout.write('\n');
            }
        }
        if (result.stderr) {
            process.stderr.write(result.stderr);
            if (!result.stderr.endsWith('\n')) {
                process.stderr.write('\n');
            }
        }
        if (result.error) {
            throw result.error;
        }
        if (result.status !== 0) {
            process.exitCode = result.status || 1;
            console.error('Remote smoke stopped at step: ' + item.name);
            return;
        }
    }
}

function writeStepOutput(options, item, result) {
    if (!options.jsonDir) {
        return;
    }
    const safeName = item.name.replace(/[^A-Za-z0-9._-]/g, '_');
    const payload = {
        step: item.name,
        command: [process.execPath, options.cli, ...item.args],
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr
    };
    fs.writeFileSync(path.join(options.jsonDir, safeName + '.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function main() {
    try {
        const options = parseArgs(process.argv.slice(2));
        const steps = buildPlan(options);
        printPlan(options, steps);
        if (options.execute) {
            runPlan(options, steps);
        }
    } catch (error) {
        process.exitCode = 1;
        console.error(error instanceof Error ? error.message : String(error));
        console.error('');
        console.error(usage());
    }
}

main();
