import * as vscode from 'vscode';
import { getEnvInfo, detectEnv, EnvInfo } from './envDetector';
import { getCurrentProject, ProjectInfo } from './projectManager';
import { generateCppProperties, updateCppPropertiesStandard } from './configGenerator';
import { log } from './logger';

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
        const cfg0 = vscode.workspace.getConfiguration('xyQt');
        const qtPath = cfg0.get<string>('qtPath', '');
        const vsPath = cfg0.get<string>('vsDevShellPath', '');
        log(`初始环境检测: qtPath="${qtPath}", vsPath="${vsPath}"`);
        detectEnv(qtPath, vsPath).then(() => {
            log('初始环境检测完成');
            this._pushEnvUpdate();
        }).catch((err) => {
            log(`初始环境检测失败: ${err}`);
        });

        webviewView.webview.onDidReceiveMessage(async msg => {
            log(`收到消息: ${msg.command}`);
            if (msg.command === 'refreshEnv') {
                const cfgR = vscode.workspace.getConfiguration('xyQt');
                await detectEnv(cfgR.get<string>('qtPath', ''), cfgR.get<string>('vsDevShellPath', ''));
                this._pushEnvUpdate();
            } else if (msg.command === 'selectProject') {
                await vscode.commands.executeCommand('xyQt.selectProject');
                this._updateHtml();
            } else if (msg.command === 'saveVsPath') {
                log(`保存 VS 路径: "${msg.value}"`);
                const cfg = vscode.workspace.getConfiguration('xyQt');
                await cfg.update('vsDevShellPath', msg.value || '', vscode.ConfigurationTarget.Workspace);
                this._view?.webview.postMessage({ command: 'envDetecting' });
                const qtPath = cfg.get<string>('qtPath', '');
                await detectEnv(qtPath, msg.value || '');
                this._pushEnvUpdate();
            } else if (msg.command === 'saveQtPath') {
                log(`保存 Qt 路径: "${msg.value}"`);
                const cfg = vscode.workspace.getConfiguration('xyQt');
                await cfg.update('qtPath', msg.value || '', vscode.ConfigurationTarget.Workspace);
                this._view?.webview.postMessage({ command: 'envDetecting' });
                const vsPath = cfg.get<string>('vsDevShellPath', '');
                await detectEnv(msg.value || '', vsPath);
                this._pushEnvUpdate();
            } else if (msg.command === 'saveStandard') {
                log(`保存标准: C=${msg.cStandard}, C++=${msg.cppStandard}`);
                const cfg = vscode.workspace.getConfiguration('xyQt');
                const t = vscode.ConfigurationTarget.Workspace;
                if (msg.cStandard) { await cfg.update('cStandard', msg.cStandard, t); }
                if (msg.cppStandard) { await cfg.update('cppStandard', msg.cppStandard, t); }
                updateCppPropertiesStandard(msg.cStandard || 'c11', msg.cppStandard || 'c++11');
            } else if (msg.command === 'browse') {
                log(`浏览: targetId=${msg.targetId}, isDir=${msg.isDir}`);
                if (msg.isDir) {
                    const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true });
                    if (uris?.[0]) {
                        log(`选择目录: ${uris[0].fsPath}`);
                        webviewView.webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
                    }
                } else {
                    const filters: { [name: string]: string[] } = { 'PowerShell': ['ps1'] };
                    const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, filters });
                    if (uris?.[0]) {
                        log(`选择文件: ${uris[0].fsPath}`);
                        webviewView.webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
                    }
                }
            } else if (msg.command === 'saveExcludeDirs') {
                log(`保存排除目录: ${JSON.stringify(msg.dirs)}`);
                const cfgE = vscode.workspace.getConfiguration('xyQt');
                await cfgE.update('scanExcludeDirs', msg.dirs, vscode.ConfigurationTarget.Workspace);
            } else if (msg.command === 'generateIntelliSense') {
                log(`生成 IntelliSense: C=${msg.cStandard}, C++=${msg.cppStandard}`);
                const cfgW = vscode.workspace.getConfiguration('xyQt');
                const t = vscode.ConfigurationTarget.Workspace;
                if (msg.cStandard) { await cfgW.update('cStandard', msg.cStandard, t); }
                if (msg.cppStandard) { await cfgW.update('cppStandard', msg.cppStandard, t); }
                const project = getCurrentProject();
                if (project) {
                    log(`项目: ${project.proFile}`);
                    generateCppProperties(project);
                } else {
                    log('无项目，无法生成 IntelliSense');
                    vscode.window.showWarningMessage('请先选择项目');
                }
            }
        });
    }

    private _pushEnvUpdate(): void {
        const env = getEnvInfo();
        log(`推送环境更新: VS=${env?.vs ? env.vs.version : '未检测'}, Qt=${env?.qt ? env.qt.version : '未检测'}, jom=${env?.jom}`);
        const cfg = vscode.workspace.getConfiguration('xyQt');
        this._view?.webview.postMessage({ command: 'envUpdated', isWin: process.platform === 'win32', env: {
            vs: env?.vs ? `VS ${env.vs.version} ${env.vs.edition}` : null,
            qt: env?.qt ? `Qt ${env.qt.version} (${env.qt.compiler})` : null,
            jom: env?.jom ?? false
        }});
        const manualShell = cfg.get<string>('vsDevShellPath', '');
        const autoShell = env?.vs?.devShellPath || '';
        const effectiveShell = manualShell || autoShell;
        const shellSource = manualShell ? '手动配置' : (autoShell ? '自动检测' : '未配置');
        this._view?.webview.postMessage({ command: 'devShellUpdated', effective: effectiveShell, source: shellSource, ok: !!effectiveShell });
        const manualQt = cfg.get<string>('qtPath', '');
        const autoQt = env?.qt?.path || '';
        const effectiveQt = manualQt || autoQt;
        const qtSource = manualQt ? '手动配置' : (autoQt ? '自动检测' : '未配置');
        this._view?.webview.postMessage({ command: 'qtPathUpdated', effective: effectiveQt, source: qtSource, ok: !!effectiveQt });
    }

    private _updateHtml(): void {
        if (!this._view) { return; }
        log('更新 HTML');
        const env = getEnvInfo();
        const project = getCurrentProject();
        log(`项目: ${project ? project.target : '无'}`);
        this._view.webview.html = this._getHtml(env, project);
    }

    private _getHtml(env: EnvInfo | null, project: ProjectInfo | null): string {
        const cfg = vscode.workspace.getConfiguration('xyQt');
        const vsDevShellPath = cfg.get<string>('vsDevShellPath', '');
        const selectedProject = cfg.get<string>('selectedProject', '');
        const projectName = project ? project.target : (selectedProject || '未选择');
        const cStandard = cfg.get<string>('cStandard', 'c11');
        const cppStandard = cfg.get<string>('cppStandard', 'c++11');
        const scanExcludeDirs = cfg.get<string[]>('scanExcludeDirs', []).join(', ');
        const autoDevShell = env?.vs?.devShellPath || '';
        const effectiveDevShell = vsDevShellPath || autoDevShell;
        const devShellSource = vsDevShellPath ? '手动配置' : (autoDevShell ? '自动检测' : '未配置');
        const qtPath = cfg.get<string>('qtPath', '');
        const autoQtPath = env?.qt?.path || '';
        const effectiveQtPath = qtPath || autoQtPath;
        const qtSource = qtPath ? '手动配置' : (autoQtPath ? '自动检测' : '未配置');

        const vsOk = !!effectiveDevShell;
        const qtOk = !!effectiveQtPath;
        const jomOk = env?.jom ?? false;
        const isWin = process.platform === 'win32';

        return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 0; margin: 0;
    line-height: 1.5;
  }
  .env-block {
    padding: 12px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
  }
  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot-ok { background: #22C55E; }
  .dot-warn { background: #F59E0B; }
  .dot-detecting {
    background: #64748B;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  .status-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    cursor: pointer;
  }
  .status-dots { display: flex; gap: 4px; }
  .status-text { color: var(--vscode-foreground); font-size: 13px; flex: 1; }
  .status-arrow { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .status-detail {
    display: none;
    padding: 12px;
    background: rgba(255, 255, 255, 0.03);
    margin-top: 4px;
    border-radius: 6px;
    font-size: 13px;
  }
  .status-detail.show { display: block; }
  .status-detail-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .status-detail-row:last-child { margin-bottom: 0; }
  .project-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .project-name { color: var(--vscode-foreground); font-size: 16px; font-weight: 600; }
  .btn {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-full { width: 100%; }
  details {
    margin-top: 8px;
  }
  details summary {
    cursor: pointer;
    list-style: none;
    color: var(--vscode-descriptionForeground);
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  details summary::-webkit-details-marker { display: none; }
  details .arrow {
    display: inline-block;
    transition: transform 0.2s;
    font-size: 10px;
  }
  details[open] .arrow { transform: rotate(90deg); }
  .details-content {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
  }
  .field-row { display: flex; gap: 8px; margin-bottom: 10px; }
  .field-row .field { flex: 1; margin-bottom: 0; }
  .field { margin-bottom: 10px; }
  .field:last-child { margin-bottom: 0; }
  label {
    display: block;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
    margin-bottom: 5px;
    font-weight: 500;
  }
  input, select {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    color: var(--vscode-foreground);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 13px;
    font-family: var(--vscode-font-family);
    outline: none;
    transition: border-color 0.15s, background 0.15s;
  }
  input:focus, select:focus {
    border-color: var(--vscode-focusBorder);
    background: rgba(255, 255, 255, 0.08);
  }
  select option {
    background: #1e1e1e;
    color: var(--vscode-foreground);
  }
  input::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }
  .input-row { display: flex; gap: 6px; }
  .input-row input { flex: 1; }
  .hint {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.55);
    margin-top: 4px;
  }
  .block-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .block-title { color: var(--vscode-foreground); font-size: 14px; font-weight: 600; }
  .block-source { color: rgba(255, 255, 255, 0.5); font-size: 11px; margin-left: auto; }
  .block-path {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 8px;
    word-break: break-all;
    line-height: 1.4;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { display: inline-block; animation: spin 1s linear infinite; }
</style>
</head>
<body>

<div class="env-block">
  <div class="status-bar" onclick="toggleEnvDetail()">
    <div class="status-dots">
      ${isWin ? `<span id="dot-vs" class="status-dot ${env ? (env.vs ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>` : ''}
      <span id="dot-qt" class="status-dot ${env ? (env.qt ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>
      <span id="dot-jom" class="status-dot ${env ? (jomOk ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>
    </div>
    <span id="status-summary" class="status-text">${env
        ? (isWin ? (env.vs ? 'VS ' + env.vs.version : 'VS 未检测') + ' · ' : '')
          + (env.qt ? 'Qt ' + env.qt.version : 'Qt 未检测') + ' · ' + (jomOk ? 'make 可用' : 'make 未找到')
        : '检测中...'}</span>
    <span id="env-arrow" class="status-arrow">▼</span>
  </div>
  <div id="env-detail" class="status-detail">
    ${isWin ? `
    <div class="status-detail-row">
      <span id="dot-vs-detail" class="status-dot ${env ? (env.vs ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>
      <span id="text-vs">${env ? (env.vs ? 'VS ' + env.vs.version + ' ' + env.vs.edition : '未检测到 Visual Studio') : '检测中...'}</span>
    </div>` : ''}
    <div class="status-detail-row">
      <span id="dot-qt-detail" class="status-dot ${env ? (env.qt ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>
      <span id="text-qt">${env ? (env.qt ? 'Qt ' + env.qt.version + ' (' + env.qt.compiler + ')' : '未检测到 Qt') : '检测中...'}</span>
    </div>
    <div class="status-detail-row">
      <span id="dot-jom-detail" class="status-dot ${env ? (jomOk ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>
      <span id="text-jom">${env ? (jomOk ? (isWin ? 'jom 可用' : 'make 可用') : (isWin ? 'jom 未找到' : 'make 未找到')) : '检测中...'}</span>
    </div>
    <div style="margin-top:10px;">
      <button id="refreshBtn" class="btn" onclick="refreshEnv()" ${!env ? 'disabled' : ''}>${!env ? '<span class="spin">↻</span> 检测中...' : '刷新检测'}</button>
    </div>
  </div>
</div>

<div class="env-block">
  <div class="project-header">
    <span class="project-name">${projectName}</span>
    <button class="btn" onclick="selectProject()">切换</button>
  </div>
  <details>
    <summary><span class="arrow">▶</span> 高级设置</summary>
    <div class="details-content">
      <div class="field-row">
        <div class="field">
          <label>C 标准</label>
          <select id="cStandard" onchange="saveStandard()">
            <option value="c89" ${cStandard === 'c89' ? 'selected' : ''}>C89</option>
            <option value="c99" ${cStandard === 'c99' ? 'selected' : ''}>C99</option>
            <option value="c11" ${cStandard === 'c11' ? 'selected' : ''}>C11</option>
            <option value="c17" ${cStandard === 'c17' ? 'selected' : ''}>C17</option>
          </select>
        </div>
        <div class="field">
          <label>C++ 标准</label>
          <select id="cppStandard" onchange="saveStandard()">
            <option value="c++11" ${cppStandard === 'c++11' ? 'selected' : ''}>C++11</option>
            <option value="c++14" ${cppStandard === 'c++14' ? 'selected' : ''}>C++14</option>
            <option value="c++17" ${cppStandard === 'c++17' ? 'selected' : ''}>C++17</option>
            <option value="c++20" ${cppStandard === 'c++20' ? 'selected' : ''}>C++20</option>
            <option value="c++23" ${cppStandard === 'c++23' ? 'selected' : ''}>C++23</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label>排除目录</label>
        <input id="scanExcludeDirs" value="${scanExcludeDirs}" placeholder="thirdparty, vendor" onblur="saveExcludeDirs()" />
        <div class="hint">已内置: build*, debug, release</div>
      </div>
      <button class="btn btn-full" style="margin-top:10px;" onclick="generateIntelliSense()">生成 IntelliSense 配置</button>
    </div>
  </details>
</div>

${isWin ? `
<div class="env-block">
  <div class="block-header">
    <span id="dot-vsblock" class="status-dot ${vsOk ? 'dot-ok' : 'dot-warn'}"></span>
    <span class="block-title">Visual Studio</span>
    <span id="vs-source" class="block-source">${devShellSource}</span>
  </div>
  <div id="vs-path" class="block-path">${effectiveDevShell || '未配置'}</div>
  <details>
    <summary><span class="arrow">▶</span> 手动覆盖</summary>
    <div class="details-content">
      <div class="field">
        <select id="vsVersion" onchange="onVersionChange()">
          <option value="">-- 快速选择版本 --</option>
          <option value="2022_community">VS 2022 Community</option>
          <option value="2022_professional">VS 2022 Professional</option>
          <option value="2022_enterprise">VS 2022 Enterprise</option>
          <option value="2019_community">VS 2019 Community</option>
          <option value="2019_professional">VS 2019 Professional</option>
          <option value="2019_enterprise">VS 2019 Enterprise</option>
        </select>
      </div>
      <div class="field">
        <div class="input-row">
          <input id="vsDevShellPath" value="${vsDevShellPath}" placeholder="手动覆盖路径" onblur="saveVsPath()" />
          <button class="btn" onclick="browse('vsDevShellPath', false)">浏览</button>
        </div>
      </div>
    </div>
  </details>
</div>
` : ''}

<div class="env-block">
  <div class="block-header">
    <span id="dot-qtblock" class="status-dot ${qtOk ? 'dot-ok' : 'dot-warn'}"></span>
    <span class="block-title">Qt</span>
    <span id="qt-source" class="block-source">${qtSource}</span>
  </div>
  <div id="qt-path" class="block-path">${effectiveQtPath || '未配置'}</div>
  <details>
    <summary><span class="arrow">▶</span> 手动覆盖</summary>
    <div class="details-content">
      <div class="field">
        <div class="input-row">
          <input id="qtPath" value="${qtPath}" placeholder="手动指定 Qt 路径" onblur="saveQtPath()" />
          <button class="btn" onclick="browse('qtPath', true)">浏览</button>
        </div>
      </div>
    </div>
  </details>
</div>

<script>
  const vscode = acquireVsCodeApi();
  const vsPaths = {
    '2022_community':    'C:\\\\Program Files\\\\Microsoft Visual Studio\\\\2022\\\\Community\\\\Common7\\\\Tools\\\\Launch-VsDevShell.ps1',
    '2022_professional': 'C:\\\\Program Files\\\\Microsoft Visual Studio\\\\2022\\\\Professional\\\\Common7\\\\Tools\\\\Launch-VsDevShell.ps1',
    '2022_enterprise':   'C:\\\\Program Files\\\\Microsoft Visual Studio\\\\2022\\\\Enterprise\\\\Common7\\\\Tools\\\\Launch-VsDevShell.ps1',
    '2019_community':    'C:\\\\Program Files (x86)\\\\Microsoft Visual Studio\\\\2019\\\\Community\\\\Common7\\\\Tools\\\\Launch-VsDevShell.ps1',
    '2019_professional': 'C:\\\\Program Files (x86)\\\\Microsoft Visual Studio\\\\2019\\\\Professional\\\\Common7\\\\Tools\\\\Launch-VsDevShell.ps1',
    '2019_enterprise':   'C:\\\\Program Files (x86)\\\\Microsoft Visual Studio\\\\2019\\\\Enterprise\\\\Common7\\\\Tools\\\\Launch-VsDevShell.ps1',
  };

  function toggleEnvDetail() {
    const detail = document.getElementById('env-detail');
    const arrow = document.getElementById('env-arrow');
    if (detail.classList.contains('show')) {
      detail.classList.remove('show');
      arrow.textContent = '▼';
    } else {
      detail.classList.add('show');
      arrow.textContent = '▲';
    }
  }

  function onVersionChange() {
    const ver = document.getElementById('vsVersion').value;
    if (ver && vsPaths[ver]) {
      document.getElementById('vsDevShellPath').value = vsPaths[ver];
      saveVsPath();
    }
  }

  function saveVsPath() {
    vscode.postMessage({ command: 'saveVsPath', value: document.getElementById('vsDevShellPath').value });
  }

  function saveQtPath() {
    vscode.postMessage({ command: 'saveQtPath', value: document.getElementById('qtPath').value });
  }

  function saveStandard() {
    vscode.postMessage({
      command: 'saveStandard',
      cStandard: document.getElementById('cStandard').value,
      cppStandard: document.getElementById('cppStandard').value
    });
  }

  function saveExcludeDirs() {
    const val = document.getElementById('scanExcludeDirs').value;
    const dirs = val.split(',').map(s => s.trim()).filter(s => s.length > 0);
    vscode.postMessage({ command: 'saveExcludeDirs', dirs });
  }

  function browse(targetId, isDir) {
    vscode.postMessage({ command: 'browse', targetId, isDir });
  }

  function refreshEnv() {
    const btn = document.getElementById('refreshBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin">↻</span> 检测中...';
    vscode.postMessage({ command: 'refreshEnv' });
  }

  function selectProject() {
    vscode.postMessage({ command: 'selectProject' });
  }

  function generateIntelliSense() {
    vscode.postMessage({
      command: 'generateIntelliSense',
      cStandard: document.getElementById('cStandard').value,
      cppStandard: document.getElementById('cppStandard').value
    });
  }

  window.addEventListener('message', e => {
    const d = e.data;
    if (d.command === 'setPath') {
      document.getElementById(d.targetId).value = d.value;
      if (d.targetId === 'vsDevShellPath') {
        saveVsPath();
      } else if (d.targetId === 'qtPath') {
        saveQtPath();
      }
    } else if (d.command === 'envUpdated') {
      const setDot = (id, ok) => {
        const dot = document.getElementById(id);
        if (dot) { dot.className = 'status-dot ' + (ok ? 'dot-ok' : 'dot-warn'); }
      };
      const setText = (id, text) => {
        const el = document.getElementById(id);
        if (el) { el.textContent = text; }
      };

      setDot('dot-qt', !!d.env.qt);
      setDot('dot-jom', d.env.jom);
      setDot('dot-qt-detail', !!d.env.qt);
      setDot('dot-jom-detail', d.env.jom);
      if (d.isWin) {
        setDot('dot-vs', !!d.env.vs);
        setDot('dot-vs-detail', !!d.env.vs);
        setText('text-vs', d.env.vs || '未检测到 Visual Studio');
      }
      setText('text-qt', d.env.qt || '未检测到 Qt');
      const makeLabel = d.isWin ? 'jom' : 'make';
      setText('text-jom', d.env.jom ? makeLabel + ' 可用' : makeLabel + ' 未找到');

      const qtVer = d.env.qt ? d.env.qt.split(' ')[1] : '';
      const vsPart = d.isWin ? (d.env.vs ? 'VS ' + d.env.vs.split(' ')[1] : 'VS 未检测') + ' · ' : '';
      document.getElementById('status-summary').textContent =
        vsPart +
        (d.env.qt ? 'Qt ' + qtVer : 'Qt 未检测') + ' · ' +
        (d.env.jom ? makeLabel + ' 可用' : makeLabel + ' 未找到');

      const btn = document.getElementById('refreshBtn');
      btn.disabled = false;
      btn.innerHTML = '刷新检测';
    } else if (d.command === 'envDetecting') {
      ['dot-vs', 'dot-qt', 'dot-jom', 'dot-vs-detail', 'dot-qt-detail', 'dot-jom-detail', 'dot-vsblock', 'dot-qtblock'].forEach(id => {
        const dot = document.getElementById(id);
        if (dot) { dot.className = 'status-dot dot-detecting'; }
      });
      document.getElementById('status-summary').textContent = '检测中...';
      setText('text-vs', '检测中...');
      setText('text-qt', '检测中...');
      setText('text-jom', '检测中...');
      const btn = document.getElementById('refreshBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spin">↻</span> 检测中...';
    } else if (d.command === 'devShellUpdated') {
      const dot = document.getElementById('dot-vsblock');
      if (dot) { dot.className = 'status-dot ' + (d.ok ? 'dot-ok' : 'dot-warn'); }
      const path = document.getElementById('vs-path');
      if (path) { path.textContent = d.effective || '未配置'; }
      const source = document.getElementById('vs-source');
      if (source) { source.textContent = d.source; }
    } else if (d.command === 'qtPathUpdated') {
      const dot = document.getElementById('dot-qtblock');
      if (dot) { dot.className = 'status-dot ' + (d.ok ? 'dot-ok' : 'dot-warn'); }
      const path = document.getElementById('qt-path');
      if (path) { path.textContent = d.effective || '未配置'; }
      const source = document.getElementById('qt-source');
      if (source) { source.textContent = d.source; }
    }
  });
</script>
</body>
</html>`;
    }
}