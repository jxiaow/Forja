/**
 * VSCode command registration for v2 command surface.
 * Qt build/run/stop/clean delegate to buildManager (VSCode task system) or remote pipeline.
 * C++ build/clean delegate to C++ VSCode commands.
 * Other commands delegate to CLI handlers.
 */
import * as vscode from 'vscode';
import { getOutputChannel } from './logger';
import { getWorkspaceRoot } from '../qt/services/configService';
import { getActiveTarget } from '../cli/commands/activeTarget';
import { loadGlobalConfig } from '../core/settingsIO';
import { resolveRemoteConfig, resolveRemotePrimaryActionPath } from '../remote/core/config';
import { createSshRunner, createScpUploader } from '../remote/core/shell';
import { buildRemoteTest } from '../remote/core/status';
import { buildRemoteDoctor } from '../remote/core/doctor';
import { buildRemoteTransferStatus } from '../remote/core/transfer';
import { executeRemoteBootstrap, findBootstrapArtifact } from '../remote/core/bootstrap';
import { executeRemoteBridge } from '../remote/core/bridge';
import { loadRemoteSettings } from '../core/settingsIO';
import { getServerById } from '../core/serverStore';
import {
    initRemoteDiagnostics,
    executeRemoteBuild, executeRemoteActionWithProgress, startForegroundRemoteRun,
} from './remoteHelpers';
import type { InternalListCategory } from '../cli/commands/list';
import type { RemoteResult } from '../cli/commands/remote';

/**
 * Register all Forja commands.
 * These commands delegate to the CLI handlers in cli/commands/.
 */
export function registerCommands(context: vscode.ExtensionContext): void {
    const workspace = () => getWorkspaceRoot() || process.cwd();

    // Resolve active target from workspaceStore
    async function resolveActiveTarget() {
        return getActiveTarget(workspace());
    }

    // Synthesize a C++ target from workspaceStore C++ settings when no activeTarget exists
    async function synthesizeCppTarget() {
        const { getActiveModule } = await import('../ui/statusBar');
        if (getActiveModule() !== 'cpp') { return null; }
        const { getCppSetting } = await import('./settingsStore');
        const pinnedProject = getCppSetting('pinnedProject');
        if (!pinnedProject) { return null; }
        return {
            id: '',
            name: '',
            kind: 'cpp' as const,
            project: pinnedProject as string,
            mode: (getCppSetting('mode') || 'debug') as 'debug' | 'release',
            arch: (getCppSetting('arch') || (process.platform === 'win32' ? 'x86' : 'x64')) as 'x86' | 'x64',
            runAt: 'local' as const,
            toolchain: {
                vsInstall: getCppSetting('vsInstall') as string,
            },
        };
    }

    // After selecting a project, prompt for toolchain version if multiple detected and none configured
    async function promptToolchainIfNeeded(kind: string) {
        const { getQtPath, getVsDevShellPath } = await import('../qt/services/configService');
        const { detectEnv } = await import('../qt/env/envDetector');
        const { inferVsInstall } = await import('../core/settingsIO');
        const { setQtSetting, setCppSetting } = await import('./settingsStore');
        const { getActiveTarget } = await import('../core/workspaceStore');
        const { resolveWorkroot, loadWorkspaceConfig } = await import('../core/workspaceStore');

        const ws = workspace();
        const workroot = resolveWorkroot(ws);
        const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
        const hasActiveTarget = wsConfig ? getActiveTarget(wsConfig) !== null : false;

        if (kind === 'qt' && !getQtPath()) {
            const env = await detectEnv();
            if (env.qtCandidates && env.qtCandidates.length > 1) {
                const items = env.qtCandidates.map(c => ({
                    label: `Qt ${c.version} (${c.compiler})`,
                    detail: c.path,
                    path: c.path,
                }));
                const picked = await vscode.window.showQuickPick(items, {
                    placeHolder: '检测到多个 Qt 版本，请选择一个',
                });
                if (picked) {
                    if (hasActiveTarget) {
                        setQtSetting('qtPath', picked.path);
                    }
                    vscode.window.showInformationMessage(`Qt 路径已选择: ${picked.path}${hasActiveTarget ? '' : '（选择目标后将自动应用）'}`);
                }
            }
        }

        if (kind === 'cpp' && !getVsDevShellPath()) {
            const env = await detectEnv();
            if (env.vsCandidates && env.vsCandidates.length > 1) {
                const items = env.vsCandidates.map(c => ({
                    label: `VS ${c.version} ${c.edition}`,
                    detail: c.devShellPath,
                    devShellPath: c.devShellPath,
                }));
                const picked = await vscode.window.showQuickPick(items, {
                    placeHolder: '检测到多个 Visual Studio 版本，请选择一个',
                });
                if (picked) {
                    if (hasActiveTarget) {
                        setCppSetting('vsInstall', inferVsInstall(picked.devShellPath));
                    }
                    vscode.window.showInformationMessage(`VS 路径已选择: ${picked.label}${hasActiveTarget ? '' : '（选择目标后将自动应用）'}`);
                }
            }
        }
    }

    const remoteDiag = initRemoteDiagnostics();
    context.subscriptions.push(remoteDiag);

    // Use the shared Forja output channel for results

    // forja.status
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.status', async () => {
            try {
                const { runStatus, formatStatusText } = await import('../cli/commands/status');
                const { resolveLocale } = await import('../cli/commands/types');
                const result = runStatus(workspace());
                const locale = resolveLocale(undefined, loadGlobalConfig().lang);
                const text = formatStatusText(result, locale);
                const ch = getOutputChannel();
                if (ch) { ch.clear(); ch.appendLine(text); ch.show(true); }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`Forja: ${msg}`);
            }
        })
    );

    // forja.init — register workroot + configure initial target
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.init', async () => {
            try {
                const { runInit, formatInitText } = await import('../cli/commands/init');
                const result = await runInit(workspace(), { interactive: true, json: false });
                const text = formatInitText(result);
                const ch = getOutputChannel();
                if (ch) { ch.clear(); ch.appendLine(text); ch.show(true); }
                if (result.ok) {
                    vscode.window.showInformationMessage('Forja: 初始化完成');
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`Forja: ${msg}`);
            }
        })
    );

    // forja.list — requires a category: targets|env
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.list', async (category?: string) => {
            try {
                const { resolveLocale } = await import('../cli/commands/types');
                const locale = resolveLocale(undefined, loadGlobalConfig().lang);
                const validCategories = ['targets', 'env'];
                if (!category || !validCategories.includes(category)) {
                    const descMap: Record<string, [string, string]> = {
                        targets: ['Qt/C++ projects', 'Qt/C++ 项目'],
                        env: ['Toolchain environment', '工具链环境'],
                    };
                    const picked = await vscode.window.showQuickPick(validCategories.map(c => ({
                        label: c,
                        description: locale === 'zh' ? (descMap[c]?.[1] || c) : (descMap[c]?.[0] || c),
                    })), { placeHolder: 'forja list <category>' });
                    if (!picked) { return; }
                    category = picked.label;
                }
                const { runList, formatListText } = await import('../cli/commands/list');
                const { resolveProjectRoot } = await import('./workspaceResolver');
                const ws = resolveProjectRoot('cpp') || resolveProjectRoot('qt') || workspace();
                const result = await runList(ws, category as InternalListCategory);
                const text = formatListText(result, locale);
                const ch = getOutputChannel();
                if (ch) { ch.clear(); ch.appendLine(text); ch.show(true); }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`Forja: ${msg}`);
            }
        })
    );

    // forja._selectTarget — internal: select target filtered by kind (qt|cpp)
    context.subscriptions.push(
        vscode.commands.registerCommand('forja._selectTarget', async (kindFilter?: string) => {
            try {
                const { runList } = await import('../cli/commands/list');
                const { resolveProjectRoot } = await import('./workspaceResolver');
                // Resolve workspace roots — skip invalid paths (like VSCode install dir)
                let qtWs = resolveProjectRoot('qt') || '';
                let cppWs = resolveProjectRoot('cpp') || '';
                // Fallback: if one is empty, use the other
                if (!qtWs && cppWs) { qtWs = cppWs; }
                if (!cppWs && qtWs) { cppWs = qtWs; }
                if (!qtWs && !cppWs) { qtWs = cppWs = workspace(); }
                const qtResult = (!kindFilter || kindFilter === 'qt') ? await runList(qtWs, 'targets') : { targets: [] };
                const cppResult = (!kindFilter || kindFilter === 'cpp') ? await runList(cppWs, 'targets') : { targets: [] };
                const seen = new Set<string>();
                const allTargets = [...(qtResult.targets || []), ...(cppResult.targets || [])].filter(t => {
                    if (kindFilter && t.kind !== kindFilter) { return false; }
                    // Deduplicate by absolute path
                    const key = `${t.kind}:${t.project}`;
                    if (seen.has(key)) { return false; }
                    seen.add(key);
                    return true;
                });
                if (allTargets.length > 0) {
                    const items = allTargets.map(t => ({
                        label: t.project,
                        description: t.current ? '(current)' : '',
                        detail: t.configured ? 'Configured' : 'Not configured',
                    }));
                    const picked = await vscode.window.showQuickPick(items, {
                        placeHolder: 'Select a target',
                    });
                    if (picked) {
                        const target = allTargets.find(t => t.project === picked.label);
                        if (target) {
                            const { runUseTarget } = await import('../cli/commands/use');
                            const targetWs = target.kind === 'cpp' ? cppWs : qtWs;
                            const useResult = await runUseTarget(targetWs, { project: target.project, interactive: true });
                            if (!useResult.ok) {
                                vscode.window.showErrorMessage(`Failed to select target: ${useResult.diagnostics?.map(d => d.message).join('; ') || 'unknown error'}`);
                                return;
                            }
                            const { setActiveModule, setCppState } = await import('../ui/statusBar');
                            const { setState } = await import('../vscode/qtState');
                            const { parseProFile } = await import('../qt/project/projectManager');
                            const { ensureLocalStateDir } = await import('../qt/shared/localState');
                            const path = await import('path');
                            ensureLocalStateDir(targetWs);
                            setActiveModule(target.kind);
                            if (target.kind === 'qt') {
                                const proPath = path.default.isAbsolute(target.project)
                                    ? target.project
                                    : path.default.join(targetWs, target.project);
                                try {
                                    const info = parseProFile(proPath);
                                    info.projectDir = path.default.dirname(proPath);
                                    setState('currentProject', info);
                                    // Generate IntelliSense for Qt project
                                    const { generateCppProperties } = await import('../qt/build/configGenerator');
                                    generateCppProperties(info);
                                } catch { /* fallback */ }
                            } else {
                                const projectName = path.default.basename(target.project, path.default.extname(target.project));
                                const { resolveWorkroot, loadWorkspaceConfig, getActiveTarget: getProfile } = await import('../core/workspaceStore');
                                const workroot = resolveWorkroot(targetWs);
                                const wsConfig = workroot ? loadWorkspaceConfig(workroot) : null;
                                const profile = wsConfig ? getProfile(wsConfig) : null;
                                const mode = profile?.mode ?? 'debug';
                                const arch = profile?.arch ?? (process.platform === 'win32' ? 'x86' : 'x64');
                                setCppState({ projectName, mode, arch });
                                // Generate IntelliSense for C++ project
                                const { generateCppPropertiesFromSln } = await import('../qt/build/configGenerator');
                                const slnAbsPath = path.default.isAbsolute(target.project)
                                    ? target.project
                                    : path.default.join(targetWs, target.project);
                                generateCppPropertiesFromSln(slnAbsPath, targetWs);
                            }
                            vscode.window.showInformationMessage(`Selected: ${target.project}`);
                            // After selecting a target, prompt for toolchain if not configured
                            await promptToolchainIfNeeded(target.kind);
                        }
                    }
                } else {
                    const kindLabel = kindFilter === 'cpp' ? 'C++' : kindFilter === 'qt' ? 'Qt' : '';
                    vscode.window.showInformationMessage(`No ${kindLabel} targets found. Run "Forja: Init" first.`);
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`Forja: ${msg}`);
            }
        })
    );

    // forja.use
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.use', async () => {
            // Open config panel as the primary "use" entry point
            vscode.commands.executeCommand('forja.config.openPage');
        })
    );

    // forja.remote — QuickPick menu for remote configuration
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.remote', async () => {
            try {
                const { runRemoteShow } = await import('../cli/commands/remote');
                const { resolveLocale } = await import('../cli/commands/types');
                const { formatRemoteText } = await import('../cli/commands/remote');
                const locale = resolveLocale(undefined, loadGlobalConfig().lang);
                const ws = workspace();
                const result = runRemoteShow(ws);
                const remote = result.remote;

                type RemoteItem = vscode.QuickPickItem & { command?: string };
                const sep = (label: string): RemoteItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
                const serverLabel = remote?.selectedServer || '(none)';
                const pathLabel = remote?.remotePath || '(none)';
                const items: RemoteItem[] = [
                    {
                        label: '$(info) Current Settings',
                        description: `Server: ${serverLabel}, Path: ${pathLabel}`,
                        command: '__show__',
                    },
                    sep('Configuration'),
                    { label: '$(server) Set Server', description: 'Select remote server', command: '__set_server__' },
                    { label: '$(folder) Set Remote Path', description: 'Set remote workspace path', command: '__set_path__' },
                    { label: '$(repo) Workspace', description: 'Configure remote workspace mode', command: '__workspace__' },
                    { label: '$(git-merge) Repo', description: 'Manage remote repo mappings', command: '__repo__' },
                    { label: '$(file-binary) Forja Bin', description: 'Set remote forja binary path', command: '__forja_bin__' },
                    { label: '$(list-ordered) Build Order', description: 'Configure remote build order', command: '__build_order__' },
                    { label: '$(cloud-upload) Transfer', description: 'Configure deploy transfer settings', command: '__transfer__' },
                ];

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: `Remote — ${serverLabel}`,
                });
                if (!selected?.command) { return; }

                const ch = getOutputChannel();
                const showResult = (r: RemoteResult) => {
                    const text = formatRemoteText(r, locale);
                    if (ch) { ch.clear(); ch.appendLine(text); ch.show(true); }
                };

                switch (selected.command) {
                    case '__show__': {
                        showResult(result);
                        break;
                    }
                    case '__set_server__': {
                        const { listServers } = await import('../cli/commands/server');
                        const servers = listServers();
                        if (servers.length === 0) {
                            vscode.window.showInformationMessage('No servers configured. Use "forja server add" in terminal.');
                            return;
                        }
                        const serverItems = servers.map(s => ({
                            label: s.name,
                            description: `${s.username}@${s.host}:${s.port}`,
                            detail: s.id === remote?.selectedServer ? '(current)' : '',
                        }));
                        const picked = await vscode.window.showQuickPick(serverItems, { placeHolder: 'Select server' });
                        if (picked) {
                            const { runRemoteSet } = await import('../cli/commands/remote');
                            const r = runRemoteSet(ws, { server: picked.label });
                            showResult(r);
                        }
                        break;
                    }
                    case '__set_path__': {
                        const pathVal = await vscode.window.showInputBox({
                            prompt: 'Remote workspace path',
                            value: remote?.remotePath || '',
                        });
                        if (pathVal !== undefined) {
                            const { runRemoteSet } = await import('../cli/commands/remote');
                            const r = runRemoteSet(ws, { remotePath: pathVal });
                            showResult(r);
                        }
                        break;
                    }
                    case '__workspace__': {
                        vscode.window.showInformationMessage('Use "forja remote set --workspace-mode staged|legacy" in terminal to configure workspace mode.');
                        break;
                    }
                    case '__repo__': {
                        vscode.window.showInformationMessage('Use "forja remote set --repo <local:remote:role>" in terminal to manage repo mappings.');
                        break;
                    }
                    case '__forja_bin__': {
                        vscode.window.showInformationMessage('Use "forja remote set --forja-bin <path>" in terminal to configure remote Forja binary.');
                        break;
                    }
                    case '__build_order__': {
                        vscode.window.showInformationMessage('Use "forja remote set --build-order qt:build cpp:build" in terminal to configure build order.');
                        break;
                    }
                    case '__transfer__': {
                        vscode.window.showInformationMessage('Use "forja remote set --transfer-server/--transfer-path/--transfer-artifact" in terminal to configure transfer.');
                        break;
                    }
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`Forja: ${msg}`);
            }
        })
    );

    // forja.server
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.server', async () => {
            try {
                const { listServers } = await import('../cli/commands/server');
                const servers = listServers();
                if (servers.length === 0) {
                    vscode.window.showInformationMessage('No servers configured. Use "forja server add" in terminal.');
                } else {
                    const items = servers.map(s => ({
                        label: s.name,
                        description: `${s.username}@${s.host}:${s.port}`,
                        detail: `ID: ${s.id}, Auth: ${s.authMode}`,
                    }));
                    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Configured servers' });
                    if (picked) {
                        const server = servers.find(s => s.name === picked.label);
                        if (server) {
                            const actions = [
                                { label: 'Remove server', action: 'remove' as const },
                                { label: 'Test connection', action: 'test' as const },
                                { label: 'Set as sync server', action: 'sync' as const },
                            ];
                            const action = await vscode.window.showQuickPick(actions, {
                                placeHolder: `Server: ${server.name}`,
                            });
                            if (action) {
                                switch (action.action) {
                                    case 'remove': {
                                        const { runServerRemove } = await import('../cli/commands/server');
                                        const r = runServerRemove(server.id, workspace());
                                        if (r.ok) {
                                            vscode.window.showInformationMessage(`Server '${server.name}' removed`);
                                        } else {
                                            vscode.window.showErrorMessage(`Remove failed: ${r.diagnostics?.map(d => d.message).join('; ') || 'unknown'}`);
                                        }
                                        break;
                                    }
                                    case 'test':
                                        await vscode.commands.executeCommand('forja.syncTestConnection');
                                        break;
                                    case 'sync': {
                                        const { configureSyncSettings } = await import('../sync/cli');
                                        const ws = workspace();
                                        const r = configureSyncSettings(ws, { enable: true, serverId: server.id });
                                        if (r.ok) {
                                            vscode.window.showInformationMessage(`Sync server set to '${server.name}'`);
                                        } else {
                                            vscode.window.showErrorMessage(`Set sync server failed: ${r.error}`);
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`Forja: ${msg}`);
            }
        })
    );

    // forja.build — Qt: buildManager (VSCode task); C++: buildCpp(); Remote: executeRemotePlan
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.build', async (action?: string) => {
            let target = await resolveActiveTarget();

            // Fallback: if no activeTarget but C++ module is active, synthesize from workspaceStore
            if (!target) {
                target = await synthesizeCppTarget();
            }

            // Remote dispatch
            if (target?.runAt === 'remote') {
                // rcc is not supported on remote targets
                if (action === 'rcc') {
                    vscode.window.showErrorMessage('RCC is not supported on remote targets. Use local target instead.');
                    return;
                }
                const remoteAction = action === 'fresh' ? 'rebuild' as const
                    : action === 'qmake' ? 'qmake' as const
                    : 'build' as const;
                await executeRemoteBuild(workspace(), target.kind, remoteAction);
                return;
            }

            if (target?.kind === 'cpp') {
                // C++ doesn't support qmake/rcc
                if (action === 'qmake' || action === 'rcc') {
                    vscode.window.showErrorMessage(`C++ target does not support '${action}' action`);
                    return;
                }
                const { buildCpp, rebuildCpp } = await import('../cpp/cppExtension');
                if (action === 'fresh') {
                    await rebuildCpp();
                } else {
                    await buildCpp();
                }
                return;
            }
            const buildManager = await import('../qt/build/buildManager');
            try {
                switch (action) {
                    case 'qmake': await buildManager.qmake(); break;
                    case 'rcc': await buildManager.rcc(); break;
                    default: await buildManager.build(); break;
                }
            } catch (e) {
                vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
            }
        })
    );

    // forja.run — Qt: buildManager.run() (VSCode task); custom/debug handled separately; Remote: foreground pty
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.run', async (customName?: string, customCommand?: string) => {
            // Legacy call from status bar: customName + customCommand both provided
            if (customName && customCommand) {
                const buildManager = await import('../qt/build/buildManager');
                await buildManager.runCustomCommand(customName, customCommand);
                return;
            }
            // --debug: use VSCode debugger
            if (customName === '--debug') {
                const { startDebug } = await import('../qt/build/debugger');
                await startDebug();
                return;
            }
            // --detach: remote detached run (must be checked before generic customName)
            if (customName === '--detach') {
                const target = await resolveActiveTarget();
                if (target?.runAt === 'remote') {
                    await executeRemoteActionWithProgress(workspace(), target.kind, 'run', 'Run Detached', ['--detach']);
                } else {
                    vscode.window.showWarningMessage('Detached run is only supported for remote targets.');
                }
                return;
            }
            // --custom <name>: look up saved command and run via buildManager (VSCode task)
            if (customName) {
                const { getCustomCommands } = await import('../qt/services/configService');
                const cmd = getCustomCommands().find(c => c.name === customName);
                if (cmd) {
                    const buildManager = await import('../qt/build/buildManager');
                    await buildManager.runCustomCommand(cmd.name, cmd.command);
                } else {
                    vscode.window.showErrorMessage(`Custom command not found: ${customName}`);
                }
                return;
            }
            const target = await resolveActiveTarget();

            // C++ doesn't support run - check before remote dispatch
            if (target?.kind === 'cpp') {
                vscode.window.showWarningMessage('C++ target does not support run. Use Build instead.');
                return;
            }

            // Remote dispatch
            if (target?.runAt === 'remote') {
                startForegroundRemoteRun(context, workspace(), target.kind);
                return;
            }

            const buildManager = await import('../qt/build/buildManager');
            try {
                await buildManager.run();
            } catch (e) {
                vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
            }
        })
    );

    // forja.debug — build + launch VSCode debugger (delegates to qt/build/debugger)
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.debug', async () => {
            const target = await resolveActiveTarget();
            if (target?.kind === 'cpp') {
                vscode.window.showWarningMessage('C++ target does not support debug. Use Build instead.');
                return;
            }
            if (target?.runAt === 'remote') {
                vscode.window.showWarningMessage('Remote target does not support debug.');
                return;
            }
            const { startDebug } = await import('../qt/build/debugger');
            await startDebug();
        })
    );

    // forja.openDesigner — open .ui file in Qt Designer
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.openDesigner', async (uri?: vscode.Uri) => {
            const { getDesignerPath, getQtPath } = await import('../qt/services/configService');
            const { launchDesigner } = await import('../qt/build/designer');

            const target = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (!target || target.scheme !== 'file') {
                vscode.window.showWarningMessage('请选择一个本地 .ui 文件');
                return;
            }

            const result = await launchDesigner(target.fsPath, getDesignerPath(), getQtPath());
            if (!result.ok) {
                vscode.window.showErrorMessage(result.error || '启动 Qt Designer 失败，请在配置面板设置 Qt Designer 路径');
            }
        })
    );

    // forja.stop — unified: delegates to runStop (PID-based kill + run state cleanup)
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.stop', async () => {
            const { runStop } = await import('../cli/commands/stop');
            const target = await resolveActiveTarget();

            // Remote dispatch with progress UI
            if (target?.runAt === 'remote') {
                await executeRemoteActionWithProgress(workspace(), target.kind, 'stop', 'Stop');
                return;
            }

            const result = await runStop(workspace());
            const msg = result.diagnostics?.[0]?.message;

            if (result.state === 'stopped') {
                vscode.window.showInformationMessage(msg ?? `Process stopped (PID: ${result.runtime?.pid ?? 'unknown'})`);
            } else if (result.state === 'not-running') {
                vscode.window.showInformationMessage(msg ?? 'No running process');
            } else if (result.state === 'unsupported') {
                vscode.window.showWarningMessage(msg ?? 'Stop not supported for this target');
            } else if (result.state === 'running') {
                vscode.window.showErrorMessage(msg ?? 'Failed to terminate process');
            }
        })
    );

    // forja.clean — Qt: buildManager.clean() (VSCode task); C++: cleanCpp(); Remote: executeRemotePlan
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.clean', async () => {
            let target = await resolveActiveTarget();

            // Fallback: if no activeTarget but C++ module is active, synthesize from workspaceStore
            if (!target) {
                target = await synthesizeCppTarget();
            }

            // Remote dispatch
            if (target?.runAt === 'remote') {
                await executeRemoteActionWithProgress(workspace(), target.kind, 'clean', 'Clean');
                return;
            }

            if (target?.kind === 'cpp') {
                const { cleanCpp } = await import('../cpp/cppExtension');
                await cleanCpp();
                return;
            }
            const buildManager = await import('../qt/build/buildManager');
            try {
                await buildManager.clean();
            } catch (e) {
                vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
            }
        })
    );

    // forja.doctor
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.doctor', async () => {
            try {
                const { runDoctor } = await import('../cli/commands/doctor');
                const result = await runDoctor(workspace());
                const checks = result.checks || [];
                const blocked = checks.filter(c => c.status === 'blocked');
                const warnings = checks.filter(c => c.status === 'warning');
                if (blocked.length === 0 && warnings.length === 0) {
                    vscode.window.showInformationMessage('Doctor: All checks passed');
                } else {
                    const msg = `Doctor: ${blocked.length} blocked, ${warnings.length} warnings`;
                    vscode.window.showWarningMessage(msg);
                }
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`Forja: ${msg}`);
            }
        })
    );

    // forja.sync — VSCode-integrated sync via syncWatcher
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.sync', async (uri?: vscode.Uri) => {
            try {
                const { executeSyncChangedFiles } = await import('./syncWatcher');
                await executeSyncChangedFiles(uri);
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(`Forja: ${msg}`);
            }
        })
    );

    // forja.showSyncTab — open config panel on the remote/sync tab
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.showSyncTab', async () => {
            vscode.commands.executeCommand('forja.config.openPage', 'sync');
        })
    );

    // forja.syncTestConnection — test remote sync connection
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.syncTestConnection', async () => {
            const { executeTestConnection } = await import('./syncWatcher');
            await executeTestConnection();
        })
    );

    // ── Remote management commands ──

    // forja.remoteTest — remote channel and version check
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.remoteTest', async () => {
            const ws = workspace();
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Forja Remote: Test',
                cancellable: false,
            }, () => buildRemoteTest({ workspace: ws }));
            if (result.ok) {
                vscode.window.showInformationMessage('Forja Remote Test: 通过');
            } else {
                const msg = result.diagnostics.map(d => d.message).filter(Boolean).join('\n');
                vscode.window.showErrorMessage('Forja Remote Test: ' + (msg || '失败'));
            }
        })
    );

    // forja.remoteBootstrap — install or update remote forja
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.remoteBootstrap', async () => {
            const ws = workspace();
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Forja Remote: Bootstrap',
                cancellable: false,
            }, async () => {
                const resolved = resolveRemoteConfig(ws);
                if (!resolved.config) {
                    vscode.window.showErrorMessage('Forja Remote: ' + resolved.diagnostics.map(d => d.message).join('; '));
                    return;
                }
                const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
                const runner = createSshRunner(resolved.config.server, password);
                const uploader = createScpUploader(resolved.config.server, password);
                const artifact = findBootstrapArtifact(context.extensionPath);
                const result = await executeRemoteBootstrap({ artifact, runner, uploader });
                if (result.ok) {
                    vscode.window.showInformationMessage('Forja Remote Bootstrap: 完成');
                } else {
                    const msg = result.diagnostics.map(d => d.message).filter(Boolean).join('\n');
                    vscode.window.showErrorMessage('Forja Remote Bootstrap: ' + (msg || '失败'));
                }
            });
        })
    );

    // forja.remoteTransferStatus — check local transfer plan
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.remoteTransferStatus', async () => {
            const ws = workspace();
            const settings = loadRemoteSettings(ws);
            const resolved = resolveRemoteConfig(ws);
            // Use transfer.deployServer for deploy server, not sync server
            const deployServer = settings.transfer?.deployServer ? getServerById(settings.transfer.deployServer) : null;
            const status = buildRemoteTransferStatus({
                remotePath: resolved.config ? resolveRemotePrimaryActionPath(resolved.config.workspace, resolved.config.remotePath) : null,
                transfer: settings.transfer,
                deployServer,
            });
            if (status.ready) {
                vscode.window.showInformationMessage('Forja Remote Transfer: 就绪');
            } else {
                const msg = status.diagnostics.map(d => d.message).filter(Boolean).join('\n');
                vscode.window.showWarningMessage('Forja Remote Transfer: ' + (msg || '未就绪'));
            }
        })
    );

    // forja.ps — remote process list (bridge action, Qt only)
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.ps', async () => {
            const ws = workspace();
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Forja Remote: PS',
                cancellable: false,
            }, async () => {
                const resolved = resolveRemoteConfig(ws);
                if (!resolved.config) {
                    vscode.window.showErrorMessage('Forja Remote: ' + resolved.diagnostics.map(d => d.message).join('; '));
                    return;
                }
                const password = resolved.config.server.password || process.env.FORJA_SSH_PASSWORD || null;
                const runner = createSshRunner(resolved.config.server, password);
                const actionRemotePath = resolveRemotePrimaryActionPath(resolved.config.workspace, resolved.config.remotePath);
                const result = await executeRemoteBridge({
                    target: 'qt',
                    action: 'ps',
                    args: [],
                    json: true,
                    remotePath: actionRemotePath,
                    runner,
                });
                if (result.ok && result.stdout) {
                    vscode.window.showInformationMessage('Forja Remote PS: ' + result.stdout.trim());
                } else if (!result.ok) {
                    const msg = result.diagnostics?.map(d => d.message).filter(Boolean).join('\n') || '失败';
                    vscode.window.showErrorMessage('Forja Remote PS: ' + msg);
                } else {
                    vscode.window.showInformationMessage('Forja Remote PS: 无运行进程');
                }
            });
        })
    );

    // forja.remoteWorkbench — QuickPick menu for remote management
    context.subscriptions.push(
        vscode.commands.registerCommand('forja.remoteWorkbench', async () => {
            const ws = workspace();
            const doctor = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Forja Remote: Workbench',
                cancellable: false,
            }, () => buildRemoteDoctor({ workspace: ws }));

            type WorkbenchItem = vscode.QuickPickItem & { command?: string };
            const sep = (label: string): WorkbenchItem => ({ label, kind: vscode.QuickPickItemKind.Separator });
            const items: WorkbenchItem[] = [
                {
                    label: '$(pulse) Doctor',
                    description: doctor.overall,
                    command: 'forja.doctor',
                },
                {
                    label: '$(info) Status',
                    description: '配置和 readiness 摘要',
                    command: 'forja.status',
                },
                {
                    label: '$(beaker) Test',
                    description: '远程通道和版本检查',
                    command: 'forja.remoteTest',
                },
                {
                    label: '$(cloud-upload) Bootstrap',
                    description: '安装或更新远端 forja',
                    command: 'forja.remoteBootstrap',
                },
                {
                    label: '$(arrow-swap) Transfer Status',
                    description: '本地校验 transfer plan',
                    command: 'forja.remoteTransferStatus',
                },
                sep('操作'),
                { label: '$(tools) Build', description: 'Remote', command: 'forja.build' },
                { label: '$(play) Run', description: 'Remote foreground Terminal', command: 'forja.run' },
                { label: '$(debug-stop) Stop', description: 'Stop remote process', command: 'forja.stop' },
                { label: '$(list-ordered) PS', description: 'Remote process list', command: 'forja.ps' },
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Remote ${doctor.overall}`,
            });
            if (selected?.command) {
                await vscode.commands.executeCommand(selected.command);
            }
        })
    );
}
