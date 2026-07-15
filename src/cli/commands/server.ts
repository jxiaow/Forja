/**
 * `forja server` — shared SSH server pool management.
 */
import {
    addServer, removeServer, updateServer, getServerById, readServers,
    ServerConfig, AuthMode,
} from '../../core/serverStore';
import { ForjaJsonResult, Diagnostic, ServerDetail, ServerSummary, Locale, T } from './types';
import { loadRemoteSettings, saveRemoteSettings, loadSyncSettings, saveSyncSettings } from '../../core/settingsIO';
import * as path from 'path';

export function formatServerText(result: ServerResult, locale: Locale): string {
    const lines: string[] = [];

    if (!result.ok) {
        lines.push(T('error'));
        if (result.diagnostics) {
            for (const d of result.diagnostics) {
                lines.push(`  ${d.message}`);
            }
        }
        if (result.nextAction) {
            lines.push(T('next'));
            lines.push(`  ${result.nextAction}`);
        }
        return lines.join('\n');
    }

    switch (result.serverAction) {
        case 'add':
            lines.push(T('serverAdded'));
            break;
        case 'update':
            lines.push(T('serverUpdated'));
            break;
        case 'remove':
            lines.push(`${T('serverRemoved')}${result.removed ? `: ${result.removed}` : ''}`);
            break;
    }

    if (result.server) {
        const s = result.server;
        lines.push(`  ${T('id')}       ${s.id}`);
        lines.push(`  ${T('name')}     ${s.name}`);
        lines.push(`  ${T('host')}     ${s.host}`);
        lines.push(`  ${T('port')}     ${s.port}`);
        lines.push(`  ${T('username')} ${s.username}`);
        lines.push(`  ${T('auth')}     ${s.authMode}`);
    }

    if (result.changed?.length) {
        lines.push(`  ${T('changed')} ${result.changed.join(', ')}`);
    }

    if (result.nextAction) {
        lines.push(T('next'));
        lines.push(`  ${result.nextAction}`);
    }
    return lines.join('\n');
}

export interface ServerResult extends ForjaJsonResult {
    action: 'server';
    serverAction: 'add' | 'update' | 'remove';
    server?: ServerDetail;
    removed?: string;
    changed: string[];
}

function toServerSummary(s: ServerConfig, selectedId?: string): ServerSummary {
    return {
        id: s.id,
        name: s.name,
        host: s.host,
        port: s.port,
        username: s.username,
        authMode: s.authMode,
        ...(selectedId !== undefined ? { selected: s.id === selectedId } : {}),
    };
}

function toServerDetail(s: ServerConfig): ServerDetail {
    return {
        id: s.id,
        name: s.name,
        host: s.host,
        port: s.port,
        username: s.username,
        authMode: s.authMode,
        privateKeyPath: s.privateKeyPath || undefined,
        strictHostKeyChecking: s.strictHostKeyChecking,
    };
}

export interface ServerAddArgs {
    name: string;
    host: string;
    username: string;
    port?: number;
    authMode?: AuthMode;
    privateKeyPath?: string;
    password?: string;
    strictHostKeyChecking?: boolean;
}

export function runServerAdd(args: ServerAddArgs): ServerResult {
    const diagnostics: Diagnostic[] = [];
    if (args.port !== undefined && (isNaN(args.port) || args.port < 1 || args.port > 65535)) {
        return {
            ok: false, action: 'server', serverAction: 'add', changed: [],
            diagnostics: [{ level: 'error', message: `${T('idx.invalidPort')}: ${args.port}` }],
            nextAction: 'forja server add --port 22',
        };
    }
    if (!args.name) {
        diagnostics.push({ level: 'error', message: T('srv.missingName') });
    }
    if (!args.host) {
        diagnostics.push({ level: 'error', message: T('srv.missingHost') });
    }
    if (!args.username) {
        diagnostics.push({ level: 'error', message: T('srv.missingUsername') });
    }
    // Validate auth mode consistency
    if (args.authMode === 'key' && !args.privateKeyPath && !args.password) {
        diagnostics.push({ level: 'error', message: T('srv.keyRequiresKeyOrPassword') });
    }
    if (args.authMode === 'password' && !args.password) {
        diagnostics.push({ level: 'error', message: T('srv.passwordRequiresPassword') });
    }
    if (diagnostics.length > 0) {
        return {
            ok: false, action: 'server', serverAction: 'add', changed: [],
            diagnostics,
            nextAction: 'forja server add --name <name> --host <host> --username <name>',
        };
    }

    try {
        const created = addServer({
            name: args.name,
            host: args.host,
            username: args.username,
            port: args.port ?? 22,
            authMode: args.authMode ?? 'key',
            privateKeyPath: args.privateKeyPath ?? '',
            password: args.password ?? '',
            strictHostKeyChecking: args.strictHostKeyChecking,
        });
        return {
            ok: true,
            action: 'server',
            serverAction: 'add',
            server: toServerDetail(created),
            changed: [`servers.${created.id}`],
            nextAction: `forja remote set --server ${created.id} --remote-path <path>`,
        };
    } catch (e) {
        return {
            ok: false, action: 'server', serverAction: 'add', changed: [],
            diagnostics: [{ level: 'error', message: `${T('srv.failedToSave')}: ${e instanceof Error ? e.message : String(e)}` }],
            nextAction: 'forja doctor',
        };
    }
}

export function runServerUpdate(id: string, updates: Partial<ServerAddArgs>): ServerResult {
    const existing = getServerById(id);
    if (!existing) {
        return {
            ok: false, action: 'server', serverAction: 'update', changed: [],
            diagnostics: [{ level: 'error', message: `${T('srv.serverNotFound')}: ${id}` }],
            nextAction: 'forja server',
        };
    }
    const patch: Partial<Omit<ServerConfig, 'id'>> = {};
    if (updates.name !== undefined) { patch.name = updates.name; }
    if (updates.host !== undefined) { patch.host = updates.host; }
    if (updates.username !== undefined) { patch.username = updates.username; }
    if (updates.port !== undefined) { patch.port = updates.port; }
    if (updates.authMode !== undefined) { patch.authMode = updates.authMode; }
    if (updates.privateKeyPath !== undefined) { patch.privateKeyPath = updates.privateKeyPath; }
    if (updates.password !== undefined) { patch.password = updates.password; }
    if (updates.strictHostKeyChecking !== undefined) { patch.strictHostKeyChecking = updates.strictHostKeyChecking; }

    // Clear stale credentials when auth mode changes
    if (updates.authMode === 'key') {
        patch.password = '';
    } else if (updates.authMode === 'password') {
        patch.privateKeyPath = '';
    }

    try {
        const ok = updateServer(id, patch);
        if (!ok) {
            return {
                ok: false, action: 'server', serverAction: 'update', changed: [],
                diagnostics: [{ level: 'error', message: `${T('srv.serverNotFound')}: ${id}` }],
                nextAction: 'forja server',
            };
        }
        const updated = getServerById(id);
        return {
            ok: true, action: 'server', serverAction: 'update',
            server: updated ? toServerDetail(updated) : undefined,
            changed: [`servers.${id}`],
            nextAction: 'forja status',
        };
    } catch (e) {
        return {
            ok: false, action: 'server', serverAction: 'update', changed: [],
            diagnostics: [{ level: 'error', message: `${T('srv.failedToSave')}: ${e instanceof Error ? e.message : String(e)}` }],
            nextAction: 'forja doctor',
        };
    }
}

export function runServerRemove(id: string, workspace: string): ServerResult {
    const existing = getServerById(id);
    if (!existing) {
        return {
            ok: false, action: 'server', serverAction: 'remove', changed: [],
            diagnostics: [{ level: 'error', message: `${T('srv.serverNotFound')}: ${id}` }],
            nextAction: 'forja server',
        };
    }
    try {
        removeServer(id);

        const changed = [`servers.${id}`];

        // Cascade cleanup: clear references in remote and sync settings
        if (workspace) {
            const ws = path.resolve(workspace);
            const remote = loadRemoteSettings(ws);
            let remoteChanged = false;
            if (remote.selectedServer === id) {
                remote.selectedServer = '';
                remoteChanged = true;
            }
            if (remote.remotePaths[id]) {
                delete remote.remotePaths[id];
                remoteChanged = true;
            }
            if (remoteChanged) {
                saveRemoteSettings(ws, remote);
                changed.push('remote.selectedServer');
            }

            const sync = loadSyncSettings(ws);
            let syncChanged = false;
            if (sync.selectedServer === id) {
                sync.selectedServer = '';
                syncChanged = true;
            }
            if (sync.remotePaths[id]) {
                delete sync.remotePaths[id];
                syncChanged = true;
            }
            if (syncChanged) {
                saveSyncSettings(ws, sync);
                changed.push('sync.selectedServer');
            }
        }

        return {
            ok: true, action: 'server', serverAction: 'remove',
            removed: id,
            changed,
            nextAction: 'forja server',
        };
    } catch (e) {
        return {
            ok: false, action: 'server', serverAction: 'remove', changed: [],
            diagnostics: [{ level: 'error', message: `${T('srv.failedToSave')}: ${e instanceof Error ? e.message : String(e)}` }],
            nextAction: 'forja doctor',
        };
    }
}

export function listServers(selectedId?: string): ServerSummary[] {
    return readServers().map(s => toServerSummary(s, selectedId));
}

export function getServerDetail(id: string): ServerDetail | null {
    const s = getServerById(id);
    return s ? toServerDetail(s) : null;
}
