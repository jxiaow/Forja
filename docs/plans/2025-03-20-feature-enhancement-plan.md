# XY Qt Tools 功能增强实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增强 XY Qt Tools 扩展，实现状态栏简化、环境自动检测、项目自动发现、构建进度可视化、调试支持和 IntelliSense 配置生成。

**Architecture:** 模块化设计，新增 projectManager、envDetector、buildProgress、debugger、configGenerator 模块，重构 statusBar 和 configPanel。

**Tech Stack:** TypeScript, VSCode Extension API, PowerShell, MSVC toolchain

---

## 文件结构

```
src/
├── extension.ts        # 修改：激活流程、命令注册
├── statusBar.ts        # 重构：新布局、进度显示
├── buildManager.ts     # 修改：支持 x64、进度回调
├── buildProgress.ts    # 新增：解析编译进度
├── envDetector.ts      # 新增：VS/Qt/jom 检测
├── projectManager.ts   # 新增：项目发现与解析
├── configPanel.ts      # 重构：分组卡片式 UI
├── configGenerator.ts  # 新增：生成 c_cpp_properties.json
├── debugger.ts         # 新增：调试支持
└── priWatcher.ts       # 保持不变
```

---

## Chunk 1: 项目管理模块

### Task 1: 创建 projectManager.ts 基础结构

**Files:**
- Create: `src/projectManager.ts`

- [ ] **Step 1: 创建项目信息接口和核心函数**

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectInfo {
    proPath: string;          // .pro 文件完整路径
    projectDir: string;       // 项目目录（相对于 workspace）
    proFile: string;          // .pro 文件名
    target: string;           // TARGET 名称
    qtModules: string[];      // QT 模块列表
    defines: string[];        // DEFINES
}

let _currentProject: ProjectInfo | null = null;

export function getCurrentProject(): ProjectInfo | null {
    return _currentProject;
}

export function setCurrentProject(project: ProjectInfo | null): void {
    _currentProject = project;
}
```

- [ ] **Step 2: 实现 .pro 文件扫描**

```typescript
export function scanProFiles(root: string): string[] {
    const proFiles: string[] = [];
    
    function scan(dir: string) {
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
                    scan(path.join(dir, entry.name));
                } else if (entry.isFile() && entry.name.endsWith('.pro')) {
                    proFiles.push(path.join(dir, entry.name));
                }
            }
        } catch {}
    }
    
    scan(root);
    return proFiles.map(p => path.relative(root, p).replace(/\\/g, '/'));
}
```

- [ ] **Step 3: 实现 .pro 文件解析**

```typescript
export function parseProFile(proPath: string): ProjectInfo {
    const content = fs.readFileSync(proPath, 'utf-8');
    const projectDir = path.dirname(proPath);
    const proFile = path.basename(proPath);
    
    // 解析 TARGET
    let target = 'app';
    const win32Match = content.match(/win32\s*\{[^}]*TARGET\s*=\s*(\S+)/s);
    if (win32Match) {
        target = win32Match[1].trim();
    } else {
        const globalMatch = content.match(/^\s*TARGET\s*=\s*(\S+)/m);
        if (globalMatch) target = globalMatch[1].trim();
    }
    
    // 解析 QT 模块
    const qtMatch = content.match(/^\s*QT\s*\+?=\s*(.+)$/m);
    const qtModules = qtMatch ? qtMatch[1].trim().split(/\s+/) : ['core', 'gui', 'widgets'];
    
    // 解析 DEFINES
    const definesMatch = content.match(/^\s*DEFINES\s*\+?=\s*(.+)$/m);
    const defines = definesMatch ? definesMatch[1].trim().split(/\s+/) : [];
    
    return {
        proPath,
        projectDir: path.basename(projectDir),
        proFile,
        target,
        qtModules,
        defines
    };
}
```

- [ ] **Step 4: 实现项目选择逻辑**

```typescript
export async function selectProject(context: vscode.ExtensionContext): Promise<ProjectInfo | null> {
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!root) {
        vscode.window.showErrorMessage('请先打开工作区');
        return null;
    }
    
    // 检查已保存的项目
    const config = vscode.workspace.getConfiguration('xyQt');
    const savedProject = config.get<string>('selectedProject');
    
    if (savedProject) {
        const fullPath = path.join(root, savedProject);
        if (fs.existsSync(fullPath)) {
            const info = parseProFile(fullPath);
            info.projectDir = path.dirname(savedProject);
            _currentProject = info;
            return info;
        }
    }
    
    // 扫描项目
    const proFiles = scanProFiles(root);
    
    if (proFiles.length === 0) {
        vscode.window.showWarningMessage('未找到 .pro 文件，请在配置面板中手动设置');
        return null;
    }
    
    if (proFiles.length === 1) {
        const fullPath = path.join(root, proFiles[0]);
        const info = parseProFile(fullPath);
        info.projectDir = path.dirname(proFiles[0]);
        await config.update('selectedProject', proFiles[0], vscode.ConfigurationTarget.Workspace);
        _currentProject = info;
        return info;
    }
    
    // 多个项目，弹出选择
    const selected = await vscode.window.showQuickPick(proFiles, {
        placeHolder: '选择项目'
    });
    
    if (selected) {
        const fullPath = path.join(root, selected);
        const info = parseProFile(fullPath);
        info.projectDir = path.dirname(selected);
        await config.update('selectedProject', selected, vscode.ConfigurationTarget.Workspace);
        _currentProject = info;
        return info;
    }
    
    return null;
}
```

- [ ] **Step 5: 编译验证**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add src/projectManager.ts
git commit -m "feat: add projectManager module for .pro discovery and parsing"
```

---

### Task 2: 创建环境检测模块

**Files:**
- Create: `src/envDetector.ts`

- [ ] **Step 1: 创建环境信息接口**

```typescript
export interface EnvInfo {
    vs: VSInfo | null;
    qt: QtInfo | null;
    jom: boolean;
}

export interface VSInfo {
    version: string;        // 2022, 2019
    edition: string;        // Community, Professional, Enterprise
    installPath: string;
    devShellPath: string;
}

export interface QtInfo {
    version: string;
    compiler: string;       // msvc2019, msvc2022, mingw
    path: string;
}
```

- [ ] **Step 2: 实现 Visual Studio 检测**

```typescript
import * as child_process from 'child_process';

export function detectVS(): VSInfo | null {
    // 通过 vswhere 检测 VS 安装
    const vswherePath = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
    
    try {
        const output = child_process.execSync(
            `"${vswherePath}" -latest -property installationPath`,
            { encoding: 'utf-8' }
        ).trim();
        
        if (!output) return null;
        
        const installPath = output;
        const devShellPath = `${installPath}\\Common7\\Tools\\Launch-VsDevShell.ps1`;
        
        // 解析版本
        const versionMatch = installPath.match(/(\d{4})/);
        const version = versionMatch ? versionMatch[1] : '2022';
        
        // 检测版本类型
        let edition = 'Community';
        if (installPath.includes('Professional')) edition = 'Professional';
        else if (installPath.includes('Enterprise')) edition = 'Enterprise';
        
        return {
            version,
            edition,
            installPath,
            devShellPath
        };
    } catch {
        return null;
    }
}
```

- [ ] **Step 3: 实现 Qt 检测**

```typescript
export function detectQt(): QtInfo | null {
    const commonPaths = [
        'C:\\QtCompile\\msvc2019-accessible',
        'C:\\QtCompile\\msvc2022-accessible',
        'C:\\Qt\\6.5.3\\msvc2019_64',
        'C:\\Qt\\6.6.0\\msvc2019_64',
    ];
    
    // 检查环境变量
    const qtdir = process.env.QTDIR || process.env.Qt6_DIR || process.env.Qt5_DIR;
    if (qtdir && fs.existsSync(qtdir)) {
        return parseQtPath(qtdir);
    }
    
    // 扫描常见路径
    for (const p of commonPaths) {
        if (fs.existsSync(p)) {
            return parseQtPath(p);
        }
    }
    
    return null;
}

function parseQtPath(qtPath: string): QtInfo {
    // 从路径解析版本和编译器
    const versionMatch = qtPath.match(/(\d+\.\d+\.\d+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';
    
    let compiler = 'msvc2019';
    if (qtPath.includes('msvc2022')) compiler = 'msvc2022';
    else if (qtPath.includes('mingw')) compiler = 'mingw';
    
    return { version, compiler, path: qtPath };
}
```

- [ ] **Step 4: 实现 jom 检测**

```typescript
export function detectJom(): boolean {
    try {
        child_process.execSync('jom -v', { encoding: 'utf-8' });
        return true;
    } catch {
        return false;
    }
}
```

- [ ] **Step 5: 实现完整环境检测**

```typescript
let _envInfo: EnvInfo | null = null;

export function getEnvInfo(): EnvInfo | null {
    return _envInfo;
}

export async function detectEnv(): Promise<EnvInfo> {
    _envInfo = {
        vs: detectVS(),
        qt: detectQt(),
        jom: detectJom()
    };
    return _envInfo;
}
```

- [ ] **Step 6: 编译验证**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add src/envDetector.ts
git commit -m "feat: add envDetector for VS/Qt/jom detection"
```

---

## Chunk 2: 状态栏重构

### Task 3: 重构 statusBar.ts

**Files:**
- Modify: `src/statusBar.ts`

- [ ] **Step 1: 重写状态栏模块**

```typescript
import * as vscode from 'vscode';
import { ProjectInfo } from './projectManager';

export type BuildMode = 'debug' | 'release';
export type Arch = 'x86' | 'x64';

let _mode: BuildMode = 'debug';
let _arch: Arch = 'x86';
let _isBuilding = false;
let _isRunning = false;
let _currentProject: ProjectInfo | null = null;

// 状态栏项
let _projectItem: vscode.StatusBarItem;
let _modeItem: vscode.StatusBarItem;
let _runItem: vscode.StatusBarItem;
let _debugItem: vscode.StatusBarItem;
let _actionItem: vscode.StatusBarItem;

export function getMode(): BuildMode { return _mode; }
export function getArch(): Arch { return _arch; }
export function isRunning(): boolean { return _isRunning; }

export function createStatusBar(context: vscode.ExtensionContext) {
    // 项目名（只读）
    _projectItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 115);
    _projectItem.tooltip = '当前项目';
    context.subscriptions.push(_projectItem);
    
    // 模式切换
    _modeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 114);
    _modeItem.command = 'xyQt.selectMode';
    _modeItem.tooltip = '切换构建模式';
    context.subscriptions.push(_modeItem);
    
    // Run 按钮
    _runItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 113);
    _runItem.command = 'xyQt.run';
    _runItem.tooltip = '运行程序';
    context.subscriptions.push(_runItem);
    
    // Debug 按钮
    _debugItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 112);
    _debugItem.command = 'xyQt.debug';
    _debugItem.tooltip = '启动调试 (F5)';
    context.subscriptions.push(_debugItem);
    
    // 操作菜单
    _actionItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 111);
    _actionItem.command = 'xyQt.showActions';
    _actionItem.text = '$(gear) 操作';
    _actionItem.tooltip = '构建操作菜单';
    context.subscriptions.push(_actionItem);
    
    updateDisplay();
}

export function setProject(project: ProjectInfo | null) {
    _currentProject = project;
    updateDisplay();
}

export function setBuilding(building: boolean) {
    _isBuilding = building;
    updateDisplay();
}

export function setRunning(running: boolean) {
    _isRunning = running;
    updateDisplay();
}

export function setBuildProgress(file: string | null, percent: number | null) {
    if (file && percent !== null) {
        _runItem.text = `$(loading~spin) ${path.basename(file)} ${percent}%`;
        _runItem.tooltip = `正在编译: ${file}`;
    } else {
        updateDisplay();
    }
}

function updateDisplay() {
    // 项目名
    if (_currentProject) {
        _projectItem.text = _currentProject.target;
        _projectItem.show();
    } else {
        _projectItem.hide();
    }
    
    // 模式
    if (_mode === 'debug') {
        _modeItem.text = '$(bug) Debug';
        _modeItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    } else {
        _modeItem.text = '$(package) Release';
        _modeItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
    }
    _modeItem.show();
    
    // Run 按钮
    if (_isRunning) {
        _runItem.text = '$(debug-stop) Stop';
        _runItem.tooltip = '终止程序';
    } else {
        _runItem.text = '$(play) Run';
        _runItem.tooltip = '运行程序';
    }
    _runItem.show();
    
    // Debug 按钮
    _debugItem.text = '$(debug-alt) Debug';
    _debugItem.show();
    
    // 操作按钮
    if (_isBuilding) {
        _actionItem.hide();
    } else {
        _actionItem.show();
    }
}

export async function toggleMode() {
    _mode = _mode === 'debug' ? 'release' : 'debug';
    updateDisplay();
}

export async function selectMode() {
    const selected = await vscode.window.showQuickPick(
        ['Debug', 'Release'],
        { placeHolder: '选择构建模式' }
    );
    if (selected) {
        _mode = selected.toLowerCase() as BuildMode;
        updateDisplay();
    }
}

export async function showActions() {
    const actions = ['QMake', 'Build', 'Clean'];
    const selected = await vscode.window.showQuickPick(actions, {
        placeHolder: '选择操作'
    });
    
    if (selected === 'QMake') {
        vscode.commands.executeCommand('xyQt.qmake');
    } else if (selected === 'Build') {
        vscode.commands.executeCommand('xyQt.build');
    } else if (selected === 'Clean') {
        vscode.commands.executeCommand('xyQt.clean');
    }
}
```

- [ ] **Step 2: 修复导入**

在文件顶部添加：
```typescript
import * as path from 'path';
```

- [ ] **Step 3: 编译验证**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/statusBar.ts
git commit -m "refactor: redesign status bar with project/mode/run/debug/action buttons"
```

---

### Task 4: 重构 buildManager.ts

**Files:**
- Modify: `src/buildManager.ts`

- [ ] **Step 1: 添加架构支持和进度回调**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getMode, getArch, setBuilding, setRunning, setBuildProgress } from './statusBar';
import { getCurrentProject, ProjectInfo } from './projectManager';

type BuildCallback = (file: string, percent: number) => void;

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('xyQt');
    const project = getCurrentProject();
    
    return {
        vsDevShell: cfg.get<string>('vsDevShellPath', ''),
        powershell: cfg.get<string>('powershellPath', 'powershell.exe'),
        projectDir: project?.projectDir || '',
        proFile: project?.proFile || '',
        exeName: project?.target || 'app',
        arch: getArch(),
        mode: getMode()
    };
}

function initShell(vsDevShell: string, arch: string): string {
    return `$currentDir = Get-Location; & '${vsDevShell}' -Arch ${arch} -SkipAutomaticLocation; Set-Location $currentDir`;
}

function killApp(exeName: string): string {
    return `Get-Process -Name ${exeName} -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Milliseconds 500`;
}

function makeShellExec(command: string, powershell: string) {
    return new vscode.ShellExecution(command, { executable: powershell, shellArgs: ['-NoProfile', '-Command'] });
}

function runTask(name: string, command: string, problemMatcher: string | string[] = '$msCompile') {
    const { powershell } = getConfig();
    const task = new vscode.Task(
        { type: 'shell', task: name },
        vscode.TaskScope.Workspace,
        name,
        'XY Qt',
        makeShellExec(command, powershell),
        problemMatcher
    );
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Shared };
    return vscode.tasks.executeTask(task);
}

export function qmake() {
    const { vsDevShell, projectDir, proFile, arch, mode } = getConfig();
    const modeConfig = mode === 'debug' ? 'CONFIG+=debug CONFIG+=console' : 'CONFIG+=release';
    const cmd = `${initShell(vsDevShell, arch)}; Set-Location ${projectDir}; qmake ${proFile} -spec win32-msvc ${modeConfig} CONFIG+=${arch}`;
    return runTask(`QMake ${mode} ${arch}`, cmd);
}

export function build() {
    const { vsDevShell, projectDir, exeName, arch, mode, powershell } = getConfig();
    const buildDir = `${mode}/${arch}`;
    const cmd = `${killApp(exeName)}; ${initShell(vsDevShell, arch)}; Set-Location ${projectDir}; jom`;
    return runTask(`Build ${mode} ${arch}`, cmd);
}

export function clean() {
    const { vsDevShell, projectDir, arch } = getConfig();
    const cmd = `${initShell(vsDevShell, arch)}; Set-Location ${projectDir}; jom clean`;
    return runTask(`Clean ${mode} ${arch}`, cmd);
}

export async function run() {
    const { vsDevShell, projectDir, exeName, arch, mode, powershell } = getConfig();
    
    setBuilding(true);
    setRunning(false);
    
    const buildCmd = `${killApp(exeName)}; ${initShell(vsDevShell, arch)}; Set-Location ${projectDir}; jom`;
    const buildTask = new vscode.Task(
        { type: 'shell', task: `Build ${mode} ${arch}` },
        vscode.TaskScope.Workspace, `Build ${mode} ${arch}`, 'XY Qt',
        makeShellExec(buildCmd, powershell), '$msCompile'
    );
    buildTask.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Shared };
    
    const execution = await vscode.tasks.executeTask(buildTask);
    
    return new Promise<void>((resolve, reject) => {
        const disposable = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === execution) {
                disposable.dispose();
                setBuilding(false);
                
                if (e.exitCode === 0) {
                    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
                    const exePath = path.join(root, projectDir, mode, arch, `${exeName}.exe`);
                    const runCmd = `${killApp(exeName)}; & '${exePath}'`;
                    const runTask = new vscode.Task(
                        { type: 'shell', task: `Run ${mode} ${arch}` },
                        vscode.TaskScope.Workspace, `Run ${mode} ${arch}`, 'XY Qt',
                        makeShellExec(runCmd, powershell), []
                    );
                    vscode.tasks.executeTask(runTask);
                    setRunning(true);
                    resolve();
                } else {
                    reject(new Error('构建失败'));
                }
            }
        });
    });
}

export function stop() {
    const { exeName } = getConfig();
    const cmd = `Get-Process -Name ${exeName} -ErrorAction SilentlyContinue | Stop-Process -Force`;
    runTask('Stop', cmd);
    setRunning(false);
}
```

- [ ] **Step 2: 编译验证**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/buildManager.ts
git commit -m "refactor: add arch support and integrate with statusBar"
```

---

## Chunk 3: 配置面板和调试

### Task 5: 重构配置面板

**Files:**
- Modify: `src/configPanel.ts`

- [ ] **Step 1: 重写配置面板**

完整代码较长，关键结构：

```typescript
import * as vscode from 'vscode';
import { getEnvInfo, detectEnv, VSInfo, QtInfo } from './envDetector';
import { selectProject, getCurrentProject, scanProFiles } from './projectManager';

export class ConfigPanel implements vscode.WebviewViewProvider {
    static readonly viewId = 'xyQt.configView';
    private _view?: vscode.WebviewView;

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        
        // 初始渲染
        this._updateHtml();
        
        // 处理消息
        webviewView.webview.onDidReceiveMessage(async msg => {
            if (msg.command === 'refreshEnv') {
                await detectEnv();
                this._updateHtml();
            } else if (msg.command === 'selectProject') {
                await selectProject(this._context);
                this._updateHtml();
            } else if (msg.command === 'setArch') {
                const cfg = vscode.workspace.getConfiguration('xyQt');
                await cfg.update('arch', msg.arch, vscode.ConfigurationTarget.Workspace);
                this._updateHtml();
            } else if (msg.command === 'save') {
                await this._saveConfig(msg.data);
            }
        });
    }

    private _updateHtml() {
        if (!this._view) return;
        const env = getEnvInfo();
        const project = getCurrentProject();
        const cfg = vscode.workspace.getConfiguration('xyQt');
        const arch = cfg.get<string>('arch', 'x86');
        
        this._view.webview.html = this._getHtml(env, project, arch);
    }

    private _getHtml(env: EnvInfo | null, project: ProjectInfo | null, arch: string): string {
        // 生成分组卡片式 HTML
        // 包含：环境状态区、项目配置区、高级设置区
        // ...
    }
}
```

- [ ] **Step 2: 编译验证**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/configPanel.ts
git commit -m "refactor: redesign config panel with grouped card layout"
```

---

### Task 6: 创建调试模块

**Files:**
- Create: `src/debugger.ts`

- [ ] **Step 1: 实现调试启动**

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { getCurrentProject } from './projectManager';
import { getMode, getArch } from './statusBar';

export async function startDebug() {
    const project = getCurrentProject();
    if (!project) {
        vscode.window.showErrorMessage('请先选择项目');
        return;
    }
    
    const mode = getMode();
    const arch = getArch();
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
    
    const exePath = path.join(root, project.projectDir, mode, arch, `${project.target}.exe`);
    const cwd = path.join(root, project.projectDir, mode, arch);
    
    const config = {
        name: `Debug ${project.target}`,
        type: 'cppvsdbg',
        request: 'launch',
        program: exePath,
        args: [],
        stopAtEntry: false,
        cwd: cwd,
        environment: [],
        console: 'integratedTerminal' as const,
        preLaunchTask: `Build ${mode} ${arch}`
    };
    
    try {
        await vscode.debug.startDebugging(undefined, config);
    } catch (e) {
        vscode.window.showErrorMessage(`启动调试失败: ${e}`);
    }
}
```

- [ ] **Step 2: 编译验证**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/debugger.ts
git commit -m "feat: add debugger module for F5 debug support"
```

---

## Chunk 4: 入口和配置生成

### Task 7: 重构 extension.ts

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 重写入口文件**

```typescript
import * as vscode from 'vscode';
import * as buildManager from './buildManager';
import { createStatusBar, setBuilding, setProject, setRunning, showActions, selectMode, getMode } from './statusBar';
import { registerPriWatcher } from './priWatcher';
import { ConfigPanel } from './configPanel';
import { selectProject, getCurrentProject } from './projectManager';
import { detectEnv, getEnvInfo } from './envDetector';
import { startDebug } from './debugger';

export async function activate(context: vscode.ExtensionContext) {
    // 创建状态栏
    createStatusBar(context);
    
    // 注册配置面板
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ConfigPanel.viewId, new ConfigPanel())
    );
    
    // 注册文件监听
    registerPriWatcher(context);
    
    // 检测环境
    await detectEnv();
    
    // 选择项目
    const project = await selectProject(context);
    setProject(project);
    
    // 构建状态同步
    const buildTaskNames = ['Build Debug x86', 'Build Release x86', 'Build Debug x64', 'Build Release x64'];
    vscode.tasks.onDidStartTask(e => {
        if (buildTaskNames.some(n => e.execution.task.name.includes(n))) {
            setBuilding(true);
        }
    });
    vscode.tasks.onDidEndTask(e => {
        if (buildTaskNames.some(n => e.execution.task.name.includes(n))) {
            setBuilding(false);
        }
    });
    
    // 错误处理
    const err = (e: Error) => vscode.window.showErrorMessage(e.message);
    
    // 注册命令
    const cmds: [string, () => void][] = [
        ['xyQt.selectMode', () => selectMode()],
        ['xyQt.selectProject', async () => { const p = await selectProject(context); setProject(p); }],
        ['xyQt.qmake', () => buildManager.qmake()],
        ['xyQt.build', () => buildManager.build()],
        ['xyQt.clean', () => buildManager.clean()],
        ['xyQt.run', () => buildManager.run().catch(err)],
        ['xyQt.stop', () => buildManager.stop()],
        ['xyQt.debug', () => startDebug()],
        ['xyQt.showActions', () => showActions()],
    ];
    
    cmds.forEach(([cmd, handler]) => {
        context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));
    });
}

export function deactivate() {}
```

- [ ] **Step 2: 编译验证**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/extension.ts
git commit -m "refactor: integrate all modules in extension entry"
```

---

### Task 8: 创建配置生成器

**Files:**
- Create: `src/configGenerator.ts`

- [ ] **Step 1: 实现 c_cpp_properties.json 生成**

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectInfo } from './projectManager';
import { getEnvInfo } from './envDetector';

export function generateCppProperties(project: ProjectInfo): void {
    const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!root) return;
    
    const env = getEnvInfo();
    const qtPath = env?.qt?.path || '';
    
    // Qt 模块对应的 include 路径
    const qtModules = project.qtModules.map(m => m.charAt(0).toUpperCase() + m.slice(1));
    const qtIncludes = qtModules.map(m => `${qtPath}/include/Qt${m}`);
    
    const config = {
        configurations: [{
            name: 'XY Qt',
            includePath: [
                '${workspaceFolder}/**',
                `${root}/${project.projectDir}`,
                `${root}/${project.projectDir}/src`,
                // 添加更多项目目录...
                `${qtPath}/include`,
                `${qtPath}/include/QtCore`,
                `${qtPath}/include/QtGui`,
                `${qtPath}/include/QtWidgets`,
                ...qtIncludes
            ],
            defines: [
                '_DEBUG',
                'UNICODE',
                '_UNICODE',
                'WIN32',
                ...project.defines,
                ...qtModules.map(m => `QT_${m.toUpperCase()}_LIB`)
            ],
            compilerPath: 'cl.exe',
            cStandard: 'c17',
            cppStandard: 'c++17',
            intelliSenseMode: 'windows-msvc-x86',
            browse: {
                path: ['${workspaceFolder}'],
                limitSymbolsToIncludedHeaders: true
            }
        }],
        version: 4
    };
    
    const vscodeDir = path.join(root, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
    }
    
    const configPath = path.join(vscodeDir, 'c_cpp_properties.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8');
    
    vscode.window.showInformationMessage('已生成 c_cpp_properties.json');
}
```

- [ ] **Step 2: 编译验证**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/configGenerator.ts
git commit -m "feat: add configGenerator for c_cpp_properties.json"
```

---

## Chunk 5: package.json 更新

### Task 9: 更新 package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 添加命令和配置**

在 `contributes.commands` 中添加：
```json
{ "command": "xyQt.selectMode", "title": "XY Qt: 选择构建模式" },
{ "command": "xyQt.selectProject", "title": "XY Qt: 选择项目" },
{ "command": "xyQt.showActions", "title": "XY Qt: 显示操作菜单" },
{ "command": "xyQt.clean", "title": "XY Qt: Clean" },
{ "command": "xyQt.stop", "title": "XY Qt: 停止" },
{ "command": "xyQt.debug", "title": "XY Qt: 调试" }
```

在 `contributes.configuration.properties` 中添加：
```json
"xyQt.selectedProject": {
    "type": "string",
    "default": "",
    "description": "当前选中的 .pro 文件路径"
},
"xyQt.arch": {
    "type": "string",
    "default": "x86",
    "enum": ["x86", "x64"],
    "description": "目标架构"
}
```

- [ ] **Step 2: 编译验证**

Run: `npm run compile`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add package.json
git commit -m "feat: add commands and configuration to package.json"
```

---

## 实现顺序总结

| 优先级 | Task | 功能 |
|--------|------|------|
| 1 | Task 1 | projectManager.ts - 项目管理 |
| 2 | Task 2 | envDetector.ts - 环境检测 |
| 3 | Task 3 | statusBar.ts - 状态栏重构 |
| 4 | Task 4 | buildManager.ts - 构建管理 |
| 5 | Task 5 | configPanel.ts - 配置面板 |
| 6 | Task 6 | debugger.ts - 调试支持 |
| 7 | Task 7 | extension.ts - 入口集成 |
| 8 | Task 8 | configGenerator.ts - 配置生成 |
| 9 | Task 9 | package.json - 命令注册 |