import * as vscode from 'vscode';
import { getState, setState } from '../../core/stateManager';
import { getHtml, TemplateData } from './template';
import { handleMessage } from './messageHandler';
import { detectEnv } from '../../qt/env/envDetector';
import { getVsDevShellPath, getQtPath, getCStandard, getCppStandard,
         getScanExcludeDirs, getPinnedProject, getTarget, getManualProPath, getDesignerPath, getQtSourcePath,
         getFileSyncPromptEnabled, getQmakeReminderEnabled, getRccProjectPath, getWorkspaceRoot } from '../../qt/services/configService';
import { createLogger } from '../../core/logger';
import { getEffectiveProjectName } from '../../qt/project/projectDisplay';
import { readServers, readProjectSyncConfig } from '../../core/serverStore';

const logger = createLogger('ConfigPanelView');

export class ConfigPanel implements vscode.WebviewViewProvider {
    static readonly viewId = 'compilot.configView';
    private _view?: vscode.WebviewView;
    private readonly _version: string;

    constructor(context: vscode.ExtensionContext) {
        this._version = context.extension.packageJSON.version ?? '';
    }

    refresh(): void {
        logger.info('refresh() called');
        this._updateHtml();
    }

    switchTab(tab: string): void {
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage({ command: 'switchTab', tab });
        }
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        logger.info('resolveWebviewView() called');
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this._updateHtml();
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this._updateHtml();
            }
        });

        // 复用已有的 envInfo，避免重复检测
        const existingEnv = getState().envInfo;
        if (existingEnv) {
            this._pushEnvUpdate();
        } else {
            const qtPath = getQtPath();
            const vsPath = getVsDevShellPath();
            logger.info(`初始环境检测: qtPath="${qtPath}", vsPath="${vsPath}"`);
            detectEnv(qtPath, vsPath).then(env => {
                logger.info('初始环境检测完成');
                setState('envInfo', env);
                this._pushEnvUpdate();
            }).catch((err) => {
                logger.error(`初始环境检测失败: ${err}`);
            });
        }

        webviewView.webview.onDidReceiveMessage(msg =>
            handleMessage(msg, webviewView.webview,
                () => this._pushEnvUpdate(),
                () => this._updateHtml())
                .catch(e => console.warn('[compilot] configPanel message error:', (e as Error).message))
        );
    }

    private _pushEnvUpdate(): void {
        const state = getState();
        const env = state.envInfo;
        const isWin = process.platform === 'win32';
        logger.info(`推送环境更新: VS=${env?.vs ? env.vs.version : '未检测'}, Qt=${env?.qt ? env.qt.version : '未检测'}, jom=${env?.jom}`);
        this._view?.webview.postMessage({ command: 'envUpdated', isWin, env: {
            vs: env?.vs ? `VS ${env.vs.version} ${env.vs.edition}` : null,
            qt: env?.qt ? `Qt ${env.qt.version} (${env.qt.compiler})` : null,
            jom: !!env?.jom
        }});
        const manualShell = getVsDevShellPath();
        const autoShell = env?.vs?.devShellPath || '';
        const effectiveShell = manualShell || autoShell;
        const shellSource = manualShell ? '手动配置' : (autoShell ? '自动检测' : '未配置');
        this._view?.webview.postMessage({ command: 'devShellUpdated', effective: effectiveShell, source: shellSource, ok: !!effectiveShell });
        const manualQt = getQtPath();
        const autoQt = env?.qt?.path || '';
        const effectiveQt = manualQt || autoQt;
        const qtSource = manualQt ? '手动配置' : (autoQt ? '自动检测' : '未配置');
        this._view?.webview.postMessage({ command: 'qtPathUpdated', effective: effectiveQt, source: qtSource, ok: !!effectiveQt });
    }

    private _updateHtml(): void {
        if (!this._view) { return; }
        logger.info('更新 HTML');
        const state = getState();
        const env = state.envInfo;
        const project = state.currentProject;
        logger.info(`项目: ${getEffectiveProjectName(project, getTarget(), '无')}`);
        const data: TemplateData = {
            env,
            project,
            vsDevShellPath: getVsDevShellPath(),
            pinnedProject: getPinnedProject(),
            cStandard: getCStandard(),
            cppStandard: getCppStandard(),
            scanExcludeDirs: getScanExcludeDirs().join(', '),
            target: getTarget(),
            isWin: process.platform === 'win32',
            autoDevShell: env?.vs?.devShellPath || '',
            autoQtPath: env?.qt?.path || '',
            qtPath: getQtPath(),
            designerPath: getDesignerPath(),
            qtSourcePath: getQtSourcePath(),
            manualProPath: getManualProPath(),
            fileSyncPromptEnabled: getFileSyncPromptEnabled(),
            qmakeReminderEnabled: getQmakeReminderEnabled(),
            rccProjectPath: getRccProjectPath(),
            version: this._version,
            ...(() => {
                const wsRoot = getWorkspaceRoot();
                const sync = wsRoot ? readProjectSyncConfig(wsRoot) : { enabled: false, selectedServer: '', ignore: ['.git', 'node_modules', 'out', '.compilot', 'build', 'debug', 'release'] };
                const servers = readServers();

                return {
                    syncEnabled: sync.enabled,
                    syncSelectedServer: sync.selectedServer,
                    syncServers: servers.map(s => ({ id: s.id, name: s.name, host: s.host, port: s.port, username: s.username, authMode: s.authMode, privateKeyPath: s.privateKeyPath, password: s.password, remotePath: s.remotePath })),
                    syncIgnore: sync.ignore.join(', ')
                };
            })()
        };
        this._view.webview.html = getHtml(data);
    }
}
