# Qt Pilot 配置面板 UI 重设计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重新设计配置面板 UI，实现状态优先布局、自动保存、折叠组件

**Architecture:** 重写 `_getHtml()` 方法，采用新的 HTML 结构和 CSS 样式，修改消息处理器支持自动保存

**Tech Stack:** TypeScript, VSCode Extension API, HTML/CSS

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/configPanel.ts` | 修改 | 重写 `_getHtml()` 方法，修改消息处理器 |

---

## Task 1: 重写 CSS 样式

**Files:**
- Modify: `src/configPanel.ts:131-181` (CSS 部分)

- [ ] **Step 1: 更新 CSS 样式**

在 `_getHtml()` 方法中替换 CSS 部分：

```css
<style>
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 0; margin: 0;
  }
  .section {
    padding: 12px;
    border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
  }
  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dot-ok { background: var(--vscode-testing-iconPassed, #22C55E); }
  .dot-warn { background: var(--vscode-statusBarItem-warningBackground, #F59E0B); }
  .dot-detecting {
    background: var(--vscode-descriptionForeground, #64748B);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  .status-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    background: var(--vscode-input-background);
    border-radius: 6px;
    cursor: pointer;
  }
  .status-dots { display: flex; gap: 4px; }
  .status-text { color: var(--vscode-foreground); font-size: 13px; flex: 1; }
  .status-arrow { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .status-detail {
    display: none;
    padding: 10px;
    background: var(--vscode-sideBar-background);
    margin-top: 4px;
    border-radius: 6px;
    font-size: 12px;
  }
  .status-detail.show { display: block; }
  .status-detail-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .status-detail-row:last-child { margin-bottom: 0; }
  .project-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .project-name { color: var(--vscode-foreground); font-size: 15px; font-weight: 600; }
  .btn {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    padding: 5px 14px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  details {
    margin-top: 8px;
  }
  details summary {
    cursor: pointer;
    list-style: none;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  details summary::-webkit-details-marker { display: none; }
  details .arrow {
    display: inline-block;
    transition: transform 0.2s;
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
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 4px;
  }
  input, select {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    outline: none;
  }
  input:focus, select:focus {
    border-color: var(--vscode-focusBorder);
    outline: 1px solid var(--vscode-focusBorder);
  }
  .input-row { display: flex; gap: 6px; }
  .input-row input { flex: 1; }
  .hint {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-top: 3px;
  }
  .block-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .block-title { color: var(--vscode-foreground); font-size: 13px; font-weight: 600; }
  .block-source { color: var(--vscode-descriptionForeground); font-size: 11px; margin-left: auto; }
  .block-path {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 8px;
    word-break: break-all;
  }
  .env-block { padding: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .env-block:first-child { border-top: none; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { display: inline-block; animation: spin 1s linear infinite; }
</style>
```

---

## Task 2: 重写 HTML 结构 - 环境状态区块

**Files:**
- Modify: `src/configPanel.ts:185-202` (环境状态 HTML)

- [ ] **Step 1: 重写环境状态区块 HTML**

替换原环境状态区块为：

```html
<div class="env-block">
  <div class="status-bar" onclick="toggleEnvDetail()">
    <div class="status-dots">
      <span id="dot-vs" class="status-dot ${env ? (env.vs ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>
      <span id="dot-qt" class="status-dot ${env ? (env.qt ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>
      <span id="dot-jom" class="status-dot ${env ? (env.jom ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>
    </div>
    <span id="status-summary" class="status-text">${env ? (env.vs ? \`VS \${env.vs.version}\` : 'VS 未检测') + ' · ' + (env.qt ? \`Qt \${env.qt.version}\` : 'Qt 未检测') + ' · ' + (env.jom ? 'jom 可用' : 'jom 未找到') : '检测中...'}</span>
    <span id="env-arrow" class="status-arrow">▼</span>
  </div>
  <div id="env-detail" class="status-detail">
    <div class="status-detail-row">
      <span id="dot-vs-detail" class="status-dot ${env ? (env.vs ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>
      <span id="text-vs">${env ? (env.vs ? \`VS \${env.vs.version} \${env.vs.edition}\` : '未检测到 Visual Studio') : '检测中...'}</span>
    </div>
    <div class="status-detail-row">
      <span id="dot-qt-detail" class="status-dot ${env ? (env.qt ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>
      <span id="text-qt">${env ? (env.qt ? \`Qt \${env.qt.version} (\${env.qt.compiler})\` : '未检测到 Qt') : '检测中...'}</span>
    </div>
    <div class="status-detail-row">
      <span id="dot-jom-detail" class="status-dot ${env ? (env.jom ? 'dot-ok' : 'dot-warn') : 'dot-detecting'}"></span>
      <span id="text-jom">${env ? (env.jom ? 'jom 可用' : 'jom 未找到') : '检测中...'}</span>
    </div>
    <div style="margin-top:10px;">
      <button id="refreshBtn" class="btn" onclick="refreshEnv()" ${!env ? 'disabled' : ''}>${!env ? '<span class="spin">↻</span> 检测中...' : '刷新检测'}</button>
    </div>
  </div>
</div>
```

---

## Task 3: 重写 HTML 结构 - 项目区块

**Files:**
- Modify: `src/configPanel.ts:204-237` (项目 HTML)

- [ ] **Step 1: 重写项目区块 HTML**

替换原项目区块为：

```html
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
      <button class="btn" style="width:100%;margin-top:10px;" onclick="generateIntelliSense()">生成 IntelliSense 配置</button>
    </div>
  </details>
</div>
```

---

## Task 4: 重写 HTML 结构 - Visual Studio 区块

**Files:**
- Modify: `src/configPanel.ts:239-263` (VS HTML)

- [ ] **Step 1: 重写 Visual Studio 区块 HTML**

替换原 VS 区块为：

```html
<div class="env-block">
  <div class="block-header">
    <span id="dot-vsblock" class="status-dot ${effectiveDevShell ? 'dot-ok' : 'dot-warn'}"></span>
    <span class="block-title">Visual Studio</span>
    <span class="block-source">${devShellSource}</span>
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
```

---

## Task 5: 重写 HTML 结构 - Qt 区块

**Files:**
- Modify: `src/configPanel.ts:265-278` (Qt HTML)

- [ ] **Step 1: 重写 Qt 区块 HTML**

替换原 Qt 区块为：

```html
<div class="env-block">
  <div class="block-header">
    <span id="dot-qtblock" class="status-dot ${effectiveQtPath ? 'dot-ok' : 'dot-warn'}"></span>
    <span class="block-title">Qt</span>
    <span class="block-source">${qtSource}</span>
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
```

---

## Task 6: 重写 JavaScript 逻辑

**Files:**
- Modify: `src/configPanel.ts:280-352` (JavaScript 部分)

- [ ] **Step 1: 重写 JavaScript 函数**

替换原 JavaScript 为：

```html
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
      
      setDot('dot-vs', !!d.env.vs);
      setDot('dot-qt', !!d.env.qt);
      setDot('dot-jom', d.env.jom);
      setDot('dot-vs-detail', !!d.env.vs);
      setDot('dot-qt-detail', !!d.env.qt);
      setDot('dot-jom-detail', d.env.jom);
      
      setText('text-vs', d.env.vs || '未检测到 Visual Studio');
      setText('text-qt', d.env.qt || '未检测到 Qt');
      setText('text-jom', d.env.jom ? 'jom 可用' : 'jom 未找到');
      
      const vsVer = d.env.vs ? d.env.vs.split(' ')[1] : '';
      const qtVer = d.env.qt ? d.env.qt.split(' ')[1] : '';
      document.getElementById('status-summary').textContent = 
        (d.env.vs ? \`VS \${vsVer}\` : 'VS 未检测') + ' · ' +
        (d.env.qt ? \`Qt \${qtVer}\` : 'Qt 未检测') + ' · ' +
        (d.env.jom ? 'jom 可用' : 'jom 未找到');
      
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
      const source = document.querySelector('.env-block:nth-child(3) .block-source');
      if (source) { source.textContent = d.source; }
    } else if (d.command === 'qtPathUpdated') {
      const dot = document.getElementById('dot-qtblock');
      if (dot) { dot.className = 'status-dot ' + (d.ok ? 'dot-ok' : 'dot-warn'); }
      const path = document.getElementById('qt-path');
      if (path) { path.textContent = d.effective || '未配置'; }
    }
  });
</script>
```

---

## Task 7: 更新后端消息处理器

**Files:**
- Modify: `src/configPanel.ts:22-68` (消息处理器)

- [ ] **Step 1: 添加新的消息处理器**

在 `onDidReceiveMessage` 中，移除旧的 `save` 处理，添加新的处理器：

```typescript
webviewView.webview.onDidReceiveMessage(async msg => {
    if (msg.command === 'refreshEnv') {
        const cfgR = vscode.workspace.getConfiguration('qtPilot');
        await detectEnv(cfgR.get<string>('qtPath', ''), cfgR.get<string>('vsDevShellPath', ''));
        this._pushEnvUpdate();
    } else if (msg.command === 'selectProject') {
        await vscode.commands.executeCommand('qtPilot.selectProject');
        this._updateHtml();
    } else if (msg.command === 'saveVsPath') {
        const cfg = vscode.workspace.getConfiguration('qtPilot');
        await cfg.update('vsDevShellPath', msg.value || '', vscode.ConfigurationTarget.Workspace);
        this._view?.webview.postMessage({ command: 'envDetecting' });
        const qtPath = cfg.get<string>('qtPath', '');
        await detectEnv(qtPath, msg.value || '');
        this._pushEnvUpdate();
    } else if (msg.command === 'saveQtPath') {
        const cfg = vscode.workspace.getConfiguration('qtPilot');
        await cfg.update('qtPath', msg.value || '', vscode.ConfigurationTarget.Workspace);
        this._view?.webview.postMessage({ command: 'envDetecting' });
        const vsPath = cfg.get<string>('vsDevShellPath', '');
        await detectEnv(msg.value || '', vsPath);
        this._pushEnvUpdate();
    } else if (msg.command === 'saveStandard') {
        const cfg = vscode.workspace.getConfiguration('qtPilot');
        const t = vscode.ConfigurationTarget.Workspace;
        if (msg.cStandard) { await cfg.update('cStandard', msg.cStandard, t); }
        if (msg.cppStandard) { await cfg.update('cppStandard', msg.cppStandard, t); }
    } else if (msg.command === 'browse') {
        if (msg.isDir) {
            const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true });
            if (uris?.[0]) {
                webviewView.webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
            }
        } else {
            const filters: { [name: string]: string[] } = { 'PowerShell': ['ps1'] };
            const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, filters });
            if (uris?.[0]) {
                webviewView.webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
            }
        }
    } else if (msg.command === 'saveExcludeDirs') {
        const cfgE = vscode.workspace.getConfiguration('qtPilot');
        await cfgE.update('scanExcludeDirs', msg.dirs, vscode.ConfigurationTarget.Workspace);
    } else if (msg.command === 'generateIntelliSense') {
        const cfgW = vscode.workspace.getConfiguration('qtPilot');
        const t = vscode.ConfigurationTarget.Workspace;
        if (msg.cStandard) { await cfgW.update('cStandard', msg.cStandard, t); }
        if (msg.cppStandard) { await cfgW.update('cppStandard', msg.cppStandard, t); }
        const project = getCurrentProject();
        if (project) {
            generateCppProperties(project);
        } else {
            vscode.window.showWarningMessage('请先选择项目');
        }
    }
});
```

- [ ] **Step 2: 删除旧的 `_saveConfig` 方法**

移除 `_saveConfig` 方法（第 101-107 行），因为不再使用。

---

## Task 8: 编译验证

- [ ] **Step 1: 运行 TypeScript 编译**

```bash
npm run compile
```

Expected: 编译成功，无错误

- [ ] **Step 2: 运行类型检查**

```bash
npx tsc --noEmit
```

Expected: 类型检查通过

---

## Task 9: 手动测试

- [ ] **Step 1: 启动扩展调试**

按 F5 启动 Extension Development Host

- [ ] **Step 2: 测试环境状态区块**

1. 点击状态栏，验证展开/收起功能
2. 点击"刷新检测"，验证状态更新
3. 验证状态指示灯颜色正确

- [ ] **Step 3: 测试项目区块**

1. 验证项目名称显示正确
2. 点击"切换"按钮，验证项目选择器
3. 展开高级设置，验证折叠功能
4. 修改 C/C++ 标准，验证自动保存
5. 输入排除目录，失焦后验证自动保存
6. 点击"生成 IntelliSense 配置"，验证功能

- [ ] **Step 4: 测试 Visual Studio 区块**

1. 验证状态指示灯和路径显示
2. 展开手动覆盖，验证折叠功能
3. 使用快速选择版本，验证路径填充
4. 手动输入路径，失焦后验证自动保存
5. 点击"浏览"，验证文件选择器

- [ ] **Step 5: 测试 Qt 区块**

1. 验证状态指示灯和路径显示
2. 展开手动覆盖，验证折叠功能
3. 手动输入路径，失焦后验证自动保存
4. 点击"浏览"，验证目录选择器

- [ ] **Step 6: 测试主题适配**

切换 VSCode 深色/浅色主题，验证颜色适配正确
