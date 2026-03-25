import * as vscode from 'vscode';
import { getState, setState } from '../../core/stateManager';
import { getHtml, TemplateData } from './template';
import { handleMessage } from './messageHandler';
import { detectEnv } from '../../env/envDetector';
import { getVsDevShellPath, getQtPath, getCStandard, getCppStandard,
         getScanExcludeDirs, getSelectedProject, getQmakeTarget } from '../../core/configService';
import { log } from '../../core/logger';

function _getVersion(): string {
    const ext = vscode.extensions.getExtension('xy.xy-qt-tools');
    return ext?.packageJSON?.version ?? '';
}

export class ConfigPanel implements vscode.WebviewViewProvider {
    static readonly viewId = 'xyQt.configView';
    private _view?: vscode.WebviewView;

    constructor() {}

    refresh(): void {
        log('refresh() called');
        this._updateHtml();
    }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        log('resolveWebviewView() called');
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this._updateHtml();

        const qtPath = getQtPath();
        const vsPath = getVsDevShellPath();
        log(`初始环境检测: qtPath="${qtPath}", vsPath="${vsPath}"`);
        detectEnv(qtPath, vsPath).then(env => {
            log('初始环境检测完成');
            setState('envInfo', env);
            this._pushEnvUpdate();
        }).catch((err) => {
            log(`初始环境检测失败: ${err}`);
        });

        webviewView.webview.onDidReceiveMessage(msg =>
            handleMessage(msg, webviewView.webview,
                () => this._pushEnvUpdate(),
                () => this._updateHtml())
        );
    }

    private _pushEnvUpdate(): void {
        const state = getState();
        const env = state.envInfo;
        const isWin = process.platform === 'win32';
        log(`推送环境更新: VS=${env?.vs ? env.vs.version : '未检测'}, Qt=${env?.qt ? env.qt.version : '未检测'}, jom=${env?.jom}`);
        this._view?.webview.postMessage({ command: 'envUpdated', isWin, env: {
            vs: env?.vs ? `VS ${env.vs.version} ${env.vs.edition}` : null,
            qt: env?.qt ? `Qt ${env.qt.version} (${env.qt.compiler})` : null,
            jom: env?.jom ?? false
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
        log('更新 HTML');
        const state = getState();
        const env = state.envInfo;
        const project = state.currentProject;
        log(`项目: ${project ? project.target : '无'}`);
        const data: TemplateData = {
            env,
            project,
            vsDevShellPath: getVsDevShellPath(),
            selectedProject: getSelectedProject(),
            cStandard: getCStandard(),
            cppStandard: getCppStandard(),
            scanExcludeDirs: getScanExcludeDirs().join(', '),
            qmakeTarget: getQmakeTarget(),
            isWin: process.platform === 'win32',
            autoDevShell: env?.vs?.devShellPath || '',
            autoQtPath: env?.qt?.path || '',
            qtPath: getQtPath(),
            version: _getVersion()
        };
        this._view.webview.html = getHtml(data);
    }
}
