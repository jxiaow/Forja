import * as path from 'path';
import { findBootstrapArtifact, findPackageRoot, executeRemoteBootstrap } from '../core/bootstrap';
import { resolveRemoteServer } from '../core/config';
import { createScpUploader, createSshRunner } from '../core/shell';
import { resolveServerSelector, ServerConfig } from '../../core/serverStore';

interface BootstrapOptions {
    workspace: string;
    json: boolean;
    force: boolean;
    serverName?: string;
}

/** Internal bridge used by the unified CLI for `forja remote bootstrap`. */
export async function runRemoteCli(argv: string[]): Promise<void> {
    const options = parseBootstrapArgs(argv);

    // Resolve server: --server flag takes priority, then fall back to sync config
    let server: ServerConfig | null = null;
    if (options.serverName) {
        const result = resolveServerSelector(options.serverName);
        server = result.server;
        if (!server) {
            process.exitCode = 1;
            const msg = result.ambiguous
                ? `Ambiguous server name: ${options.serverName}`
                : `Server not found: ${options.serverName}`;
            writeOutput({ ok: false, action: 'bootstrap', mode: 'remote', diagnostics: [{ level: 'error', message: msg }], nextAction: 'forja server' }, options.json);
            return;
        }
    } else {
        const resolved = resolveRemoteServer(options.workspace);
        if (!resolved.server) {
            process.exitCode = 1;
            writeOutput({ ok: false, action: 'bootstrap', mode: 'remote', diagnostics: resolved.diagnostics, nextAction: resolved.nextAction }, options.json);
            return;
        }
        server = resolved.server;
    }

    const artifact = findBootstrapArtifact(findPackageRoot(__dirname) || path.resolve(__dirname, '..', '..', '..'));
    if (!artifact.ok) {
        process.exitCode = 1;
        writeOutput({ ok: false, action: 'bootstrap', mode: 'remote', diagnostics: artifact.diagnostics, nextAction: artifact.nextAction }, options.json);
        return;
    }

    const password = server.password || process.env.FORJA_SSH_PASSWORD || null;
    const result = await executeRemoteBootstrap({
        artifact,
        runner: createSshRunner(server, password),
        uploader: createScpUploader(server, password),
        ignoreEngines: options.force,
    });
    if (!result.ok) { process.exitCode = 1; }
    // Add server info to result for display (structural extension, no `any` cast)
    Object.assign(result, {
        serverName: options.serverName || server.name,
        host: server.host
    });
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
        } else if (arg === '--server') {
            const serverName = argv[++index];
            if (!serverName || serverName.startsWith('--')) { throw new Error('--server requires a value.'); }
            options.serverName = serverName;
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
    const value = result as { ok?: boolean; action?: string; mode?: string; version?: string; remoteBin?: string; serverName?: string; host?: string; stages?: Array<{ name: string; ok: boolean; message?: string }>; diagnostics?: Array<{ level?: string; message: string }>; nextAction?: string };
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
    // Success output
    if (value.action === 'bootstrap' && value.ok === true) {
        console.log('Bootstrap 成功');
        if (value.serverName) {
            console.log(`  服务器: ${value.serverName} (${value.host})`);
        }
        if (value.version) {
            console.log(`  版本: ${value.version}`);
        }
        if (value.remoteBin) {
            console.log(`  远程路径: ${value.remoteBin}`);
        }
        if (value.stages && value.stages.length > 0) {
            const completed = value.stages.filter(s => s.ok).length;
            console.log(`  步骤: ${completed}/${value.stages.length} 完成`);
            // Extract warnings from stage messages
            for (const stage of value.stages) {
                if (stage.message && stage.message.includes('WARN')) {
                    // Extract EBADENGINE warning details
                    const engineMatch = stage.message.match(/required:.*?node:\s*'([^']+)'.*?current:.*?node:\s*'([^']+)'/s);
                    if (engineMatch) {
                        console.log(`  警告: Node.js 版本不匹配 (需要 ${engineMatch[1]}, 当前 ${engineMatch[2]})`);
                    } else {
                        // Fallback: show first WARN line
                        const warnLine = stage.message.split(/\r?\n/).find(l => l.includes('WARN'));
                        if (warnLine) {
                            console.log(`  警告: ${warnLine.replace(/npm WARN\s*/, '').substring(0, 80)}`);
                        }
                    }
                }
            }
        }
    }
    for (const diagnostic of value.diagnostics ?? []) {
        if (diagnostic.level === 'warning') {
            console.log(`⚠ ${diagnostic.message}`);
        } else {
            console.log(diagnostic.message);
        }
    }
    if (value.nextAction) {
        console.log(`\nNext: ${value.nextAction}`);
    }
}
