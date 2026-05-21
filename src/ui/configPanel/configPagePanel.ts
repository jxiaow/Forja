/**
 * 编辑器标签页配置面板 — 每个配置页在编辑器区域以 WebviewPanel 打开。
 * 管理多个 panel 实例（每种页面最多一个），复用已打开的 panel。
 */
import * as vscode from 'vscode';
import { ConfigPageId } from './configNavTree';
import { handleMessage } from './messageHandler';
import { getState, setState } from '../../core/qtState';
import { detectEnv } from '../../qt/env/envDetector';
import { getPageHtml } from './pageTemplate';
import { buildTemplateData } from './templateData';
import { createLogger } from '../../core/logger';
import { onSettingsChange, getQtSetting, getSdkSetting } from '../../core/settingsStore';

const logger = createLogger('ConfigPagePanel');

const PAGE_TITLES: Record<ConfigPageId, string> = {
    project: '项目配置',
    env: '环境配置',
    sync: '远程同步',
    advanced: '高级配置',
};

export class ConfigPageManager {
    private _panels = new Map<ConfigPageId, vscode.WebviewPanel>();
    private readonly _context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;

        // 监听 mode/arch 变化，推送到已打开的 project 页面
        const disposable = onSettingsChange((section, key) => {
            if (section === 'qt' && (key === 'mode' || key === 'arch')) {
                const projectPanel = this._panels.get('project');
                if (projectPanel) {
                    projectPanel.webview.postMessage({
                        command: 'settingsUpdated',
                        mode: getQtSetting('mode'),
                        arch: getQtSetting('arch')
                    });
                }
            }
            if (section === 'sdk' && (key === 'mode' || key === 'arch' || key === 'pinnedProject')) {
                const projectPanel = this._panels.get('project');
                if (projectPanel) {
                    projectPanel.webview.postMessage({
                        command: 'sdkSettingsUpdated',
                        sdkMode: getSdkSetting('mode'),
                        sdkArch: getSdkSetting('arch'),
                        sdkProjectName: getSdkSetting('pinnedProject') || '未选择'
                    });
                }
            }
        });
        context.subscriptions.push(disposable);
    }

    /** 打开或聚焦指定配置页 */
    openPage(pageId: ConfigPageId): void {
        const existing = this._panels.get(pageId);
        if (existing) {
            existing.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            `compilot.config.${pageId}`,
            PAGE_TITLES[pageId],
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        this._panels.set(pageId, panel);

        panel.onDidDispose(() => {
            this._panels.delete(pageId);
        });

        panel.webview.onDidReceiveMessage(msg =>
            handleMessage(msg, panel.webview,
                () => this._pushEnvUpdate(panel.webview),
                () => this._updatePageHtml(pageId))
                .catch(e => logger.warn(`消息处理错误: ${(e as Error).message}`))
        );

        this._updatePageHtml(pageId);

        // 环境页打开时触发检测
        if (pageId === 'env') {
            detectEnv().then(env => {
                setState('envInfo', env);
                this._pushEnvUpdate(panel.webview);
            }).catch(e => logger.error(`环境检测失败: ${e}`));
        }
    }

    /** 刷新所有已打开的配置页 */
    refresh(): void {
        for (const [pageId] of this._panels) {
            this._updatePageHtml(pageId);
        }
    }

    /** 兼容旧接口：打开远程同步页 */
    switchTab(tab: string): void {
        if (tab === 'remote') {
            this.openPage('sync');
        }
    }

    private _updatePageHtml(pageId: ConfigPageId): void {
        const panel = this._panels.get(pageId);
        if (!panel) { return; }
        const data = buildTemplateData(this._context);
        panel.webview.html = getPageHtml(pageId, data);
    }

    private _pushEnvUpdate(webview: vscode.Webview): void {
        const state = getState();
        const env = state.envInfo;
        webview.postMessage({
            command: 'envUpdated',
            isWin: process.platform === 'win32',
            env: {
                vs: env?.vs ? `VS ${env.vs.version} ${env.vs.edition}` : null,
                qt: env?.qt ? `Qt ${env.qt.version} (${env.qt.compiler})` : null,
                jom: env?.jom || null
            },
            vsCandidates: (env?.vsCandidates ?? []).map(c => ({ label: `VS ${c.version} ${c.edition}`, value: c.devShellPath })),
            qtCandidates: (env?.qtCandidates ?? []).map(c => ({ label: `Qt ${c.version} (${c.compiler})`, value: c.path }))
        });
    }
}
