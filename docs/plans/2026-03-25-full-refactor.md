# 全面重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全面重构 qt-pilot 扩展，引入服务层、统一状态管理、拆分巨型文件、抽象平台层，消除重复逻辑。

**Architecture:** 引入 `stateManager` 作为单一状态源（事件驱动），`configService` 统一配置读写和路径解析，拆分 `configPanel` 为目录结构（index/messageHandler/template），抽象 platform builder 为基类+平台配置，提取公共工具函数到 `utils.ts`。

**Tech Stack:** TypeScript, VSCode Extension API

---

## 重构后目标结构

```
src/
├── extension.ts              # 入口，精简为初始化+命令注册
├── stateManager.ts           # 单一状态源，事件订阅
├── configService.ts          # 统一配置读写、BuildConfig 组装、路径解析
├── utils.ts                  # 通用工具函数 (execAsync, readDir, isDir)
├── statusBar.ts              # 纯 UI 层，订阅 stateManager
├── buildManager.ts           # 构建编排，用 configService
├── debugger.ts               # 调试启动，用 configService
├── configGenerator.ts        # IntelliSense 生成，用 configService
├── projectManager.ts         # 纯工具：扫描/解析 .pro，无状态
├── priWatcher.ts             # 文件监听（基本不变）
├── envDetector.ts            # Qt 扫描公共逻辑 + detectEnv 入口，无状态
├── logger.ts                 # 不变
├── configPanel/
│   ├── index.ts              # WebviewViewProvider，消息路由
│   ├── messageHandler.ts     # 消息处理逻辑
│   └── template.ts           # HTML/CSS/JS 模板
└── platform/
    ├── builder.ts            # BuildConfig 接口 + 抽象基础命令组装
    ├── platformConfig.ts     # 平台配置接口 + win/linux 配置常量
    ├── win/
    │   ├── builder.ts        # Windows 平台配置
    │   └── envDetector.ts    # 不变
    └── linux/
        ├── builder.ts        # Linux 平台配置
        └── envDetector.ts    # 不变
```

---

## Task 1: 提取 `src/utils.ts` — 通用工具函数

**Files:**
- Create: `src/utils.ts`
- Modify: `src/envDetector.ts` — 删除 `execAsync`, `readDir`, `isDir`，改为从 utils 导入
- Modify: `src/platform/win/envDetector.ts` — import 路径改为 utils
- Modify: `src/platform/linux/envDetector.ts` — import 路径改为 utils

- [ ] **Step 1: 创建 `src/utils.ts`**

从 `envDetector.ts` 提取三个函数：

```typescript
import * as child_process from 'child_process';
import * as fs from 'fs';

export function execAsync(cmd: string, args: string[]): Promise<string> {
    return new Promise(resolve => {
        const proc = child_process.spawn(cmd, args, { windowsHide: true });
        let out = '';
        proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('close', () => resolve(out));
        proc.on('error', () => resolve(''));
    });
}

export function readDir(dir: string): string[] {
    try { return fs.readdirSync(dir); } catch { return []; }
}

export function isDir(p: string): boolean {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
```

- [ ] **Step 2: 修改 `src/envDetector.ts`**

删除 `execAsync`, `readDir`, `isDir` 的实现，改为从 utils 重新导出：

```typescript
// 顶部 import 替换
import { execAsync, readDir, isDir } from './utils';

// 删除原有的三个函数实现

// 保留重新导出（因为 platform/win/envDetector 和 platform/linux/envDetector 目前从这里导入）
export { execAsync, readDir, isDir };
```

- [ ] **Step 3: 运行 typecheck 验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/utils.ts src/envDetector.ts
git commit -m "refactor: extract utils.ts from envDetector"
```

---

## Task 2: 创建 `src/stateManager.ts` — 单一状态源

**Files:**
- Create: `src/stateManager.ts`

- [ ] **Step 1: 创建 stateManager**

```typescript
import * as vscode from 'vscode';
import { ProjectInfo } from './projectManager';
import { EnvInfo } from './envDetector';

export type BuildMode = 'debug' | 'release';
export type Arch = 'x86' | 'x64';

export interface AppState {
    mode: BuildMode;
    arch: Arch;
    isBuilding: boolean;
    isRunning: boolean;
    currentProject: ProjectInfo | null;
    envInfo: EnvInfo | null;
}

type StateKey = keyof AppState;
type StateListener = (key: StateKey, state: AppState) => void;

const _state: AppState = {
    mode: 'debug',
    arch: 'x86',
    isBuilding: false,
    isRunning: false,
    currentProject: null,
    envInfo: null
};

const _listeners: StateListener[] = [];

export function getState(): Readonly<AppState> {
    return _state;
}

export function setState<K extends StateKey>(key: K, value: AppState[K]): void {
    if (_state[key] === value) { return; }
    _state[key] = value;
    _listeners.forEach(fn => fn(key, _state));
}

export function onStateChange(listener: StateListener): vscode.Disposable {
    _listeners.push(listener);
    return new vscode.Disposable(() => {
        const idx = _listeners.indexOf(listener);
        if (idx >= 0) { _listeners.splice(idx, 1); }
    });
}
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/stateManager.ts
git commit -m "refactor: add stateManager as single source of truth"
```

---

## Task 3: 创建 `src/configService.ts` — 统一配置读写与路径解析

**Files:**
- Create: `src/configService.ts`

- [ ] **Step 1: 创建 configService**

合并散落在 buildManager.getConfig()、debugger、configGenerator 中的配置读取和路径解析逻辑：

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { BuildConfig } from './platform/builder';
import { getState } from './stateManager';

// ── 配置读取 ──

function cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('qtPilot');
}

export function getWorkspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
}

export function getVsDevShellPath(): string {
    return cfg().get<string>('vsDevShellPath', '');
}

export function getQtPath(): string {
    return cfg().get<string>('qtPath', '');
}

export function getSelectedProject(): string {
    return cfg().get<string>('selectedProject', '');
}

export function getCStandard(): string {
    return cfg().get<string>('cStandard', 'c11');
}

export function getCppStandard(): string {
    return cfg().get<string>('cppStandard', 'c++11');
}

export function getScanExcludeDirs(): string[] {
    return cfg().get<string[]>('scanExcludeDirs', []);
}

export async function updateConfig(key: string, value: unknown): Promise<void> {
    await cfg().update(key, value, vscode.ConfigurationTarget.Workspace);
}

// ── BuildConfig 组装 ──

export function getBuildConfig(): BuildConfig {
    const state = getState();
    const root = getWorkspaceRoot();
    const project = state.currentProject;
    const env = state.envInfo;
    const mode = state.mode;
    const projectDir = project?.projectDir ? path.join(root, project.projectDir) : '';
    const rawDestDir = project?.destDir || '';
    const destDir = rawDestDir.replace(/\{MODE\}/g, mode);
    return {
        vsDevShell: getVsDevShellPath() || env?.vs?.devShellPath || '',
        qtPath: getQtPath() || env?.qt?.path || '',
        projectDir,
        proFile: project?.proFile || '',
        exeName: project?.target || 'app',
        destDir,
        arch: state.arch,
        mode
    };
}

// ── 路径解析 ──

export function getProjectDir(): string {
    const state = getState();
    const root = getWorkspaceRoot();
    return state.currentProject?.projectDir ? path.join(root, state.currentProject.projectDir) : '';
}

export function getEffectiveVsDevShell(): string {
    const state = getState();
    return getVsDevShellPath() || state.envInfo?.vs?.devShellPath || '';
}

export function getEffectiveQtPath(): string {
    const state = getState();
    return getQtPath() || state.envInfo?.qt?.path || '';
}
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/configService.ts
git commit -m "refactor: add configService for unified config access"
```

---

## Task 4: 重构 `src/platform/` — 抽象 builder 公共逻辑

**Files:**
- Create: `src/platform/platformConfig.ts`
- Modify: `src/platform/builder.ts` — 新增 `createBuilder()` 工厂函数
- Modify: `src/platform/win/builder.ts` — 改为导出 `PlatformConfig`
- Modify: `src/platform/linux/builder.ts` — 改为导出 `PlatformConfig`

- [ ] **Step 1: 创建 `src/platform/platformConfig.ts`**

定义平台差异化配置接口：

```typescript
import { BuildConfig } from './builder';

export interface PlatformConfig {
    // 命令组装
    shellExecutable: string | null;       // win: 'cmd.exe', linux: null
    shellArgs: string[] | null;           // win: ['/c'], linux: null
    commandJoiner: string;                // win: ' && ', linux: ' && '

    // 环境初始化命令
    initCommands(cfg: BuildConfig): string[];

    // 平台特定命令
    cdCommand(dir: string): string;       // win: 'cd /d "dir"', linux: 'cd "dir"'
    killCommand(exeName: string): string;
    stopCommands(exeName: string): string[];

    // qmake
    qmakeSpec: string;                    // win: 'win32-msvc', linux: 'linux-g++'
    qmakeExtraArgs(cfg: BuildConfig): string;  // win: 'CONFIG+=x86', linux: ''
    qmakeMatcher: string | string[];      // win: '$msCompile', linux: '$gcc'

    // build
    buildCommand: string;                 // win: 'jom', linux: 'make -j$(nproc)'
    buildMatcher: string | string[];      // win: '$msCompile', linux: []

    // clean
    cleanCommand: string;                 // win: 'jom clean', linux: 'make clean'
    cleanMatcher: string | string[];      // win: '$msCompile', linux: '$gcc'

    // exe 路径
    exePath(root: string, cfg: BuildConfig): string;
}
```

- [ ] **Step 2: 创建 win 平台配置 — 修改 `src/platform/win/builder.ts`**

```typescript
import * as path from 'path';
import { PlatformConfig } from '../platformConfig';
import { BuildConfig } from '../builder';

function getVsDevCmd(vsDevShell: string): string {
    return vsDevShell.replace(/Launch-VsDevShell\.ps1$/i, 'VsDevCmd.bat');
}

export const winConfig: PlatformConfig = {
    shellExecutable: 'cmd.exe',
    shellArgs: ['/c'],
    commandJoiner: ' && ',

    initCommands(cfg: BuildConfig): string[] {
        if (!cfg.vsDevShell) { return []; }
        return [`call "${getVsDevCmd(cfg.vsDevShell)}" -arch=${cfg.arch} -no_logo`];
    },

    cdCommand(dir: string): string {
        return `cd /d "${dir}"`;
    },

    killCommand(exeName: string): string {
        return `taskkill /F /IM ${exeName}.exe 2>nul & timeout /t 1 /nobreak >nul`;
    },

    stopCommands(exeName: string): string[] {
        return [`taskkill /F /IM ${exeName}.exe`];
    },

    qmakeSpec: 'win32-msvc',
    qmakeExtraArgs(cfg: BuildConfig): string { return `CONFIG+=${cfg.arch}`; },
    qmakeMatcher: '$msCompile',

    buildCommand: 'jom',
    buildMatcher: '$msCompile',

    cleanCommand: 'jom clean',
    cleanMatcher: '$msCompile',

    exePath(root: string, cfg: BuildConfig): string {
        if (cfg.destDir) { return path.join(cfg.projectDir, cfg.destDir, `${cfg.exeName}.exe`); }
        return path.join(cfg.projectDir, cfg.mode, cfg.arch, `${cfg.exeName}.exe`);
    }
};
```

- [ ] **Step 3: 创建 linux 平台配置 — 修改 `src/platform/linux/builder.ts`**

```typescript
import * as path from 'path';
import { PlatformConfig } from '../platformConfig';
import { BuildConfig } from '../builder';

export const linuxConfig: PlatformConfig = {
    shellExecutable: null,
    shellArgs: null,
    commandJoiner: ' && ',

    initCommands(cfg: BuildConfig): string[] {
        if (!cfg.qtPath) { return []; }
        return [`export PATH="${cfg.qtPath}/bin:$PATH"`];
    },

    cdCommand(dir: string): string {
        return `cd "${dir}"`;
    },

    killCommand(exeName: string): string {
        return `pkill -x ${exeName} 2>/dev/null; true`;
    },

    stopCommands(exeName: string): string[] {
        return [`pkill -x ${exeName}`];
    },

    qmakeSpec: 'linux-g++',
    qmakeExtraArgs(): string { return ''; },
    qmakeMatcher: '$gcc',

    buildCommand: 'make -j$(nproc)',
    buildMatcher: [],

    cleanCommand: 'make clean',
    cleanMatcher: '$gcc',

    exePath(root: string, cfg: BuildConfig): string {
        if (cfg.destDir) { return path.join(cfg.projectDir, cfg.destDir, cfg.exeName); }
        return path.join(cfg.projectDir, cfg.exeName);
    }
};
```

- [ ] **Step 4: 修改 `src/platform/builder.ts` — 添加工厂函数**

保留 `BuildConfig` 和 `PlatformBuilder` 接口，新增 `createBuilder()` 基于 PlatformConfig 生成 PlatformBuilder：

```typescript
import * as vscode from 'vscode';
import { PlatformConfig } from './platformConfig';

// BuildConfig 和 PlatformBuilder 接口保持不变

export function createBuilder(config: PlatformConfig): PlatformBuilder {
    function assembleCommands(cfg: BuildConfig, specificCmds: string[]): string[] {
        return [
            ...config.initCommands(cfg),
            config.cdCommand(cfg.projectDir),
            ...specificCmds
        ];
    }

    return {
        makeExec(commands: string[]): vscode.ShellExecution {
            const cmd = commands.join(config.commandJoiner);
            if (config.shellExecutable) {
                return new vscode.ShellExecution(cmd, {
                    executable: config.shellExecutable,
                    shellArgs: config.shellArgs || []
                });
            }
            return new vscode.ShellExecution(cmd);
        },

        killApp(exeName: string): string {
            return config.killCommand(exeName);
        },

        qmakeCommands(cfg: BuildConfig) {
            const modeConfig = cfg.mode === 'debug'
                ? 'CONFIG+=debug CONFIG+=console'
                : 'CONFIG+=release';
            const extra = config.qmakeExtraArgs(cfg);
            const qmakeCmd = `qmake ${cfg.proFile} -spec ${config.qmakeSpec} ${modeConfig}${extra ? ' ' + extra : ''}`;
            return {
                commands: assembleCommands(cfg, [qmakeCmd]),
                matcher: config.qmakeMatcher
            };
        },

        buildCommands(cfg: BuildConfig) {
            return {
                commands: assembleCommands(cfg, [config.buildCommand]),
                matcher: config.buildMatcher
            };
        },

        cleanCommands(cfg: BuildConfig) {
            return {
                commands: assembleCommands(cfg, [config.cleanCommand]),
                matcher: config.cleanMatcher
            };
        },

        exePath(root: string, cfg: BuildConfig): string {
            return config.exePath(root, cfg);
        },

        stopCommands(exeName: string): string[] {
            return config.stopCommands(exeName);
        }
    };
}
```

- [ ] **Step 5: 运行 typecheck 验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: Commit**

```bash
git add src/platform/
git commit -m "refactor: abstract platform builder with PlatformConfig"
```

---

## Task 5: 重构 `src/envDetector.ts` — 去状态化

**Files:**
- Modify: `src/envDetector.ts` — 删除 `_envInfo` 缓存和 `getEnvInfo()`，`detectEnv()` 改为纯函数返回结果

- [ ] **Step 1: 修改 envDetector.ts**

删除模块级 `_envInfo` 变量和 `getEnvInfo()` 函数。`detectEnv()` 不再写入内部缓存，只返回结果。调用方（extension.ts）负责将结果写入 stateManager。

保留的导出：
- `EnvInfo`, `VSInfo`, `QtInfo` 类型
- `execAsync`, `readDir`, `isDir`（从 utils 重新导出）
- `hasQmake`, `parseQtInfo`, `scanQt` 公共 Qt 扫描逻辑
- `detectEnv()` — 纯函数，返回 `Promise<EnvInfo>`

删除的导出：
- `getEnvInfo()` — 被 `getState().envInfo` 替代

- [ ] **Step 2: 运行 typecheck 验证**

此时会有编译错误，因为其他文件还在用 `getEnvInfo()`。先记录，后续 Task 中修复。

- [ ] **Step 3: Commit**

```bash
git add src/envDetector.ts
git commit -m "refactor: make envDetector stateless"
```

---

## Task 6: 重构 `src/projectManager.ts` — 去状态化

**Files:**
- Modify: `src/projectManager.ts` — 删除 `_currentProject` 和 `getCurrentProject()`/`setCurrentProject()`

- [ ] **Step 1: 修改 projectManager.ts**

删除模块级 `_currentProject` 变量和 `getCurrentProject()`/`setCurrentProject()` 函数。

`selectProject()` 不再写入内部状态，只返回 `ProjectInfo | null`。调用方负责写入 stateManager。

保留的导出：
- `ProjectInfo` 类型
- `scanProFiles()`, `parseProFile()` 纯工具函数
- `selectProject()` — 返回结果但不存储

删除的导出：
- `getCurrentProject()` — 被 `getState().currentProject` 替代
- `setCurrentProject()` — 被 `setState('currentProject', ...)` 替代

- [ ] **Step 2: Commit**

```bash
git add src/projectManager.ts
git commit -m "refactor: make projectManager stateless"
```

---

## Task 7: 重构 `src/statusBar.ts` — 纯 UI 层

**Files:**
- Modify: `src/statusBar.ts` — 删除内部状态，订阅 stateManager

- [ ] **Step 1: 重写 statusBar.ts**

删除所有模块级状态变量（`_mode`, `_arch`, `_isBuilding`, `_isRunning`, `_currentProject`）和对应的 getter/setter。

改为：
- `createStatusBar()` 中订阅 `onStateChange()`，在回调中调用 `_updateDisplay()`
- `_updateDisplay()` 从 `getState()` 读取所有状态
- `showActions()` 中模式切换通过 `setState('mode', ...)` 和 `setState('arch', ...)` 写入
- 删除 `BuildMode` 和 `Arch` 类型导出（移到 stateManager）

删除的导出：
- `getMode()`, `getArch()`, `isRunning()` — 被 `getState()` 替代
- `setBuilding()`, `setRunning()`, `setProject()` — 被 `setState()` 替代
- `BuildMode`, `Arch` 类型 — 移到 stateManager

保留的导出：
- `createStatusBar()` — 初始化 UI
- `showActions()` — 操作菜单

- [ ] **Step 2: Commit**

```bash
git add src/statusBar.ts
git commit -m "refactor: statusBar as pure UI subscribing to stateManager"
```

---

## Task 8: 重构 `src/buildManager.ts` — 使用 configService

**Files:**
- Modify: `src/buildManager.ts`

- [ ] **Step 1: 重写 buildManager.ts**

- 删除 `getConfig()` 函数，改用 `configService.getBuildConfig()`
- 删除对 statusBar 的 import（`getMode`, `getArch`, `setBuilding`, `setRunning`）
- 构建状态通过 `setState('isBuilding', ...)` 和 `setState('isRunning', ...)` 写入 stateManager
- builder 实例改为从 `createBuilder()` + 平台配置创建
- `runTask()` 保持不变

```typescript
import * as vscode from 'vscode';
import { setState } from './stateManager';
import { getBuildConfig, getWorkspaceRoot } from './configService';
import { createBuilder } from './platform/builder';
import { winConfig } from './platform/win/builder';
import { linuxConfig } from './platform/linux/builder';
import { log } from './logger';

const builder = createBuilder(process.platform === 'win32' ? winConfig : linuxConfig);

// runTask 不变
// qmake/build/clean 改用 getBuildConfig()
// run() 中 setBuilding/setRunning 改用 setState()
// stop() 同理
```

- [ ] **Step 2: Commit**

```bash
git add src/buildManager.ts
git commit -m "refactor: buildManager uses configService and stateManager"
```

---

## Task 9: 重构 `src/debugger.ts` — 使用 configService

**Files:**
- Modify: `src/debugger.ts`

- [ ] **Step 1: 重写 debugger.ts**

- 删除对 `projectManager` 和 `statusBar` 的 import
- 改用 `getState()` 获取 currentProject、mode、arch
- 改用 `getWorkspaceRoot()` 获取 root
- exePath 拼接逻辑改用 `configService` 或直接用 builder.exePath()

```typescript
import * as vscode from 'vscode';
import { getState } from './stateManager';
import { getBuildConfig, getWorkspaceRoot } from './configService';
import { createBuilder } from './platform/builder';
import { winConfig } from './platform/win/builder';
import { linuxConfig } from './platform/linux/builder';

const builder = createBuilder(process.platform === 'win32' ? winConfig : linuxConfig);

export async function startDebug(): Promise<void> {
    const state = getState();
    const project = state.currentProject;
    if (!project) {
        vscode.window.showErrorMessage('请先选择项目');
        return;
    }
    const cfg = getBuildConfig();
    const root = getWorkspaceRoot();
    const exePath = builder.exePath(root, cfg);
    // ... 其余调试配置不变
}
```

- [ ] **Step 2: Commit**

```bash
git add src/debugger.ts
git commit -m "refactor: debugger uses configService and stateManager"
```

---

## Task 10: 重构 `src/configGenerator.ts` — 使用 configService

**Files:**
- Modify: `src/configGenerator.ts`

- [ ] **Step 1: 修改 configGenerator.ts**

- 删除对 `projectManager.getCurrentProject()` 的 import，改用 `getState().currentProject`
- 删除对 `statusBar.getArch()` 的 import，改用 `getState().arch`
- 删除对 `envDetector.getEnvInfo()` 的 import，改用 `getState().envInfo`
- 配置读取改用 `configService` 的 getter

- [ ] **Step 2: Commit**

```bash
git add src/configGenerator.ts
git commit -m "refactor: configGenerator uses configService and stateManager"
```

---

## Task 11: 拆分 `src/configPanel.ts` → `src/configPanel/` 目录

**Files:**
- Create: `src/configPanel/template.ts` — HTML/CSS/JS 模板
- Create: `src/configPanel/messageHandler.ts` — 消息处理逻辑
- Create: `src/configPanel/index.ts` — WebviewViewProvider 壳
- Delete: `src/configPanel.ts`

- [ ] **Step 1: 创建 `src/configPanel/template.ts`**

从原 `configPanel.ts` 的 `_getHtml()` 方法提取。改为纯函数：

```typescript
import { EnvInfo } from '../envDetector';
import { ProjectInfo } from '../projectManager';

export interface TemplateData {
    env: EnvInfo | null;
    project: ProjectInfo | null;
    vsDevShellPath: string;
    selectedProject: string;
    cStandard: string;
    cppStandard: string;
    scanExcludeDirs: string;
    isWin: boolean;
}

export function getHtml(data: TemplateData): string {
    // 原 _getHtml() 的全部 HTML/CSS/JS 模板逻辑
    // 从 data 参数读取所有值，不再直接调用 vscode.workspace.getConfiguration
}
```

- [ ] **Step 2: 创建 `src/configPanel/messageHandler.ts`**

从原 `resolveWebviewView()` 的 `onDidReceiveMessage` 回调提取：

```typescript
import * as vscode from 'vscode';
import { detectEnv } from '../envDetector';
import { generateCppProperties, updateCppPropertiesStandard } from '../configGenerator';
import { getState } from '../stateManager';
import { updateConfig, getQtPath, getVsDevShellPath } from '../configService';
import { log } from '../logger';

export async function handleMessage(
    msg: any,
    webview: vscode.Webview,
    pushEnvUpdate: () => void,
    updateHtml: () => void
): Promise<void> {
    log(`收到消息: ${msg.command}`);

    switch (msg.command) {
        case 'refreshEnv': { /* ... */ break; }
        case 'selectProject': { /* ... */ break; }
        case 'saveVsPath': { /* ... */ break; }
        case 'saveQtPath': { /* ... */ break; }
        case 'saveStandard': { /* ... */ break; }
        case 'browse': { /* ... */ break; }
        case 'saveExcludeDirs': { /* ... */ break; }
        case 'generateIntelliSense': { /* ... */ break; }
    }
}
```

- [ ] **Step 3: 创建 `src/configPanel/index.ts`**

精简的 WebviewViewProvider：

```typescript
import * as vscode from 'vscode';
import { getState, onStateChange } from '../stateManager';
import { getEnvInfo } from '../envDetector';  // 如果还需要
import { getHtml, TemplateData } from './template';
import { handleMessage } from './messageHandler';
import { detectEnv } from '../envDetector';
import { getVsDevShellPath, getQtPath, getEffectiveVsDevShell, getEffectiveQtPath,
         getCStandard, getCppStandard, getScanExcludeDirs, getSelectedProject } from '../configService';
import { log } from '../logger';

export class ConfigPanel implements vscode.WebviewViewProvider {
    static readonly viewId = 'qtPilot.configView';
    private _view?: vscode.WebviewView;

    constructor() {}

    refresh(): void { this._updateHtml(); }

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        this._updateHtml();

        // 初始环境检测
        const qtPath = getQtPath();
        const vsPath = getVsDevShellPath();
        detectEnv(qtPath, vsPath).then(() => {
            this._pushEnvUpdate();
        }).catch((err) => {
            log(`初始环境检测失败: ${err}`);
        });

        // 消息路由委托给 messageHandler
        webviewView.webview.onDidReceiveMessage(msg =>
            handleMessage(msg, webviewView.webview,
                () => this._pushEnvUpdate(),
                () => this._updateHtml())
        );
    }

    private _pushEnvUpdate(): void { /* 同原逻辑，从 stateManager 读状态 */ }
    private _updateHtml(): void { /* 组装 TemplateData，调用 getHtml() */ }
}
```

- [ ] **Step 4: 删除原 `src/configPanel.ts`**

- [ ] **Step 5: 更新 `src/extension.ts` 的 import 路径**

```typescript
// 旧
import { ConfigPanel } from './configPanel';
// 新
import { ConfigPanel } from './configPanel/index';
```

- [ ] **Step 6: 运行 typecheck 验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: Commit**

```bash
git add src/configPanel/ src/extension.ts
git rm src/configPanel.ts
git commit -m "refactor: split configPanel into directory (index/messageHandler/template)"
```

---

## Task 12: 重构 `src/extension.ts` — 精简入口

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 重写 extension.ts**

精简为：
1. 初始化 logger
2. 创建 statusBar（内部订阅 stateManager）
3. 创建 configPanel
4. 注册 priWatcher
5. 环境检测一次，结果写入 stateManager
6. 自动选择项目，结果写入 stateManager
7. 注册命令

```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as buildManager from './buildManager';
import { setState } from './stateManager';
import { getQtPath, getVsDevShellPath, getWorkspaceRoot } from './configService';
import { createStatusBar, showActions } from './statusBar';
import { registerPriWatcher } from './priWatcher';
import { ConfigPanel } from './configPanel/index';
import { selectProject } from './projectManager';
import { startDebug } from './debugger';
import { generateCppProperties } from './configGenerator';
import { initLogger, log } from './logger';
import { detectEnv } from './envDetector';

export async function activate(context: vscode.ExtensionContext) {
    const channel = initLogger();
    context.subscriptions.push(channel);
    log('扩展激活');

    createStatusBar(context);

    const panel = new ConfigPanel();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ConfigPanel.viewId, panel)
    );

    registerPriWatcher(context);

    // 环境检测（一次）
    detectEnv(getQtPath(), getVsDevShellPath()).then(env => {
        setState('envInfo', env);
        log('启动环境检测完成');
    }).catch((e: Error) => log(`启动环境检测失败: ${e.message}`));

    // 自动选择项目
    const project = await selectProject(context);
    setState('currentProject', project);

    // 自动生成 c_cpp_properties.json
    if (project) {
        const root = getWorkspaceRoot();
        if (root) {
            const cppPropsPath = path.join(root, '.vscode', 'c_cpp_properties.json');
            if (!fs.existsSync(cppPropsPath)) {
                generateCppProperties(project);
            }
        }
    }

    const err = (e: Error) => vscode.window.showErrorMessage(e.message);

    const cmds: [string, () => void][] = [
        ['qtPilot.selectProject', async () => {
            const p = await selectProject(context, true);
            setState('currentProject', p);
            panel.refresh();
        }],
        ['qtPilot.showActions',   () => showActions()],
        ['qtPilot.qmake',         () => buildManager.qmake()],
        ['qtPilot.build',         () => buildManager.build()],
        ['qtPilot.clean',         () => buildManager.clean()],
        ['qtPilot.run',           () => buildManager.run().catch(err)],
        ['qtPilot.stop',          () => buildManager.stop()],
        ['qtPilot.debug',         () => startDebug()]
    ];

    cmds.forEach(([cmd, handler]) => {
        context.subscriptions.push(vscode.commands.registerCommand(cmd, handler));
    });
}
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "refactor: simplify extension.ts entry point"
```

---

## Task 13: 最终验证与清理

**Files:**
- Modify: `AGENTS.md` — 更新项目结构文档

- [ ] **Step 1: 全量 typecheck**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 2: 编译**

Run: `npm run compile`
Expected: 编译成功

- [ ] **Step 3: 更新 AGENTS.md 中的项目结构**

更新 `## Project Structure` 部分，反映新的目录结构。

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "refactor: complete full refactoring, update docs"
```

