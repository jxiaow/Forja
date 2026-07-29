import * as path from 'path';
import { findBootstrapArtifact, findPackageRoot, executeRemoteBootstrap } from '../core/bootstrap';
import { resolveRemoteServer } from '../core/config';
import { createScpUploader, createSshRunner } from '../core/shell';

interface BootstrapOptions {
    workspace: string;
    json: boolean;
    force: boolean;
}

/** Internal bridge used by the unified CLI for `forja remote bootstrap`. */
export async function runRemoteCli(argv: string[]): Promise<void> {
    const options = parseBootstrapArgs(argv);
    const resolved = resolveRemoteServer(options.workspace);
    if (!resolved.server) {
        process.exitCode = 1;
        writeOutput({ ok: false, action: 'bootstrap', mode: 'remote', diagnostics: resolved.diagnostics, nextAction: resolved.nextAction }, options.json);
        return;
    }

    const artifact = findBootstrapArtifact(findPackageRoot(__dirname) || path.resolve(__dirname, '..', '..', '..'));
    if (!artifact.ok) {
        process.exitCode = 1;
        writeOutput({ ok: false, action: 'bootstrap', mode: 'remote', diagnostics: artifact.diagnostics, nextAction: artifact.nextAction }, options.json);
        return;
    }

    const password = resolved.server.password || process.env.FORJA_SSH_PASSWORD || null;
    const result = await executeRemoteBootstrap({
        artifact,
        runner: createSshRunner(resolved.server, password),
        uploader: createScpUploader(resolved.server, password),
        ignoreEngines: options.force,
    });
    if (!result.ok) { process.exitCode = 1; }
    writeOutput(result, options.json);
}

function parseBootstrapArgs(argv: string[]): BootstrapOptions {
    if (argv[0] !== 'bootstrap') {
        throw new Error('Only remote bootstrap is available.');
    }
    const options: BootstrapOptions = { workspace: process.cwd(), json: false, force: false };
    for (let index = 1; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--workspace') {
            const workspace = argv[++index];
            if (!workspace || workspace.startsWith('--')) { throw new Error('--workspace requires a value.'); }
            options.workspace = path.resolve(workspace);
        } else if (arg === '--json') {
            options.json = true;
        } else if (arg === '--force') {
            options.force = true;
        } else {
            throw new Error(`Unknown remote bootstrap option: ${arg}`);
        }
    }
    return options;
}

function writeOutput(result: unknown, json: boolean): void {
    if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    const value = result as { ok?: boolean; diagnostics?: Array<{ message: string }>; nextAction?: string };
    if (value.ok === false) {
        console.log('Error');
        for (const diagnostic of value.diagnostics ?? []) {
            console.log(`  error: ${diagnostic.message}`);
        }
        if (value.nextAction) {
            console.log(`\nNext\n  ${value.nextAction}`);
        }
        return;
    }
    for (const diagnostic of value.diagnostics ?? []) {
        console.log(diagnostic.message);
    }
    if (value.nextAction) {
        console.log(`Next: ${value.nextAction}`);
    }
}
