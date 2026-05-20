/**
 * 统一状态栏 — Qt 和 SDK 共用一套 status bar item。
 *
 * 显示当前活跃模块的项目名 + 构建模式，点击弹出统一 quick menu。
 * play 按钮根据活跃模块执行 run（Qt）或 build（SDK）。
 */
import * as vscode from 'vscode';
import { getState, setState, onStateChange, BuildMode, Arch } from '../core/qtState';
import { getQtSetting } from '../core/settingsStore';
import { getTarget, getCustomCommands } from '../qt/services/configService';
import { getEffectiveProjectName } from '../qt/project/projectDisplay';
import { getModeDisplayLabel } from './statusBarLabels';

export type ActiveModule = 'qt' | 'sdk';

let _activeModule: ActiveModule = 'qt';
let _projectModeItem: vscode.StatusBarItem;
let _runItem: vscode.StatusBarItem;
let _debugItem: vscode.StatusBarItem;

// SDK state references (set by SDK module after init)
let _sdkProjectName: string = '';
let _sdkMode: string = 'debug';
let _sdkArch: string = 'x86';
let _sdkIsBuilding: boolean = false;
let _sdkUpdateListeners: (() => void)[] = [];

export function getActiveModule(): ActiveModule { return _activeModule; }
export function setActiveModule(m: ActiveModule): void {
    _activeModule = m;
    _updateDisplay();
}

export function getRunStatusBarItem(): vscode.StatusBarItem { return _runItem; }

// SDK 模块调用这些函数来更新状态栏
export function setSdkState(opts: { projectName?: string; mode?: string; arch?: string; isBuilding?: boolean }): void {
    if (opts.projectName !== undefined) { _sdkProjectName = opts.projectName; }
    if (opts.mode !== undefined) { _sdkMode = opts.mode; }
    if (opts.arch !== undefined) { _sdkArch = opts.arch; }
    if (opts.isBuilding !== undefined) { _sdkIsBuilding = opts.isBuilding; }
    if (_activeModule === 'sdk') { _updateDisplay(); }
}

export function onSdkUpdate(fn: () => void): void { _sdkUpdateListeners.push(fn); }

export function createUnifiedStatusBar(context: vscode.ExtensionContext): void {
    _projectModeItem = vscode.window.createStatusBarItem('compilot.projectMode', vscode.StatusBarAlignment.Left, 113);
    _projectModeItem.name = 'Compilot: Project';
    _projectModeItem.command = 'compilot.showActions';
    context.subscriptions.push(_projectModeItem);

    _runItem = vscode.window.createStatusBarItem('compilot.run', vscode.StatusBarAlignment.Left, 112);
    _runItem.name = 'Compilot: Run/Build';
    context.subscriptions.push(_runItem);

    _debugItem = vscode.window.createStatusBarItem('compilot.debug', vscode.StatusBarAlignment.Left, 111);
    _debugItem.name = 'Compilot: Debug';
    _debugItem.command = 'compilot.qt.debug';
    _debugItem.text = '$(debug-alt)';
    _debugItem.tooltip = '构建并启动调试';
    context.subscriptions.push(_debugItem);

    context.subscriptions.push(new vscode.Disposable(onStateChange(() => {
        if (_activeModule === 'qt') { _updateDisplay(); }
    })));

    // 注册统一 showActions 命令
    context.subscriptions.push(
        vscode.commands.registerCommand('compilot.showActions', () => showUnifiedActions())
    );

    _updateDisplay();
}

function _updateDisplay(): void {
    if (_activeModule === 'qt') {
        _updateQtDisplay();
    } else {
        _updateSdkDisplay();
    }
}

function _updateQtDisplay(): void {
    const state = getState();
    const projectName = getEffectiveProjectName(state.currentProject, getTarget(), '未选择项目');
    const modeLabel = getModeDisplayLabel(state.mode, state.arch, process.platform === 'win32');
    _projectModeItem.text = `$(tools) ${projectName} · ${modeLabel}`;
    _projectModeItem.tooltip = 'Compilot: 点击选择模式/架构、构建操作、切换项目';
    _projectModeItem.color = state.mode === 'debug'
        ? new vscode.ThemeColor('statusBarItem.warningForeground')
        : undefined;
    _projectModeItem.show();

    if (state.isBuilding && state.buildAction === 'run') {
        _runItem.text = '$(sync~spin)';
        _runItem.tooltip = 'Compilot: 正在为运行编译';
        _runItem.command = undefined;
    } else if (state.isRunning) {
        _runItem.text = '$(debug-stop)';
        _runItem.tooltip = 'Compilot: 终止程序';
        _runItem.command = 'compilot.qt.stop';
    } else {
        _runItem.text = '$(play)';
        _runItem.tooltip = 'Compilot: 构建并运行';
        _runItem.command = 'compilot.qt.run';
    }
    _runItem.show();

    if (state.isBuilding && state.buildAction === 'debug') {
        _debugItem.text = '$(sync~spin)';
        _debugItem.tooltip = 'Compilot: 正在为调试编译';
        _debugItem.command = undefined;
    } else {
        _debugItem.text = '$(debug-alt)';
        _debugItem.tooltip = 'Compilot: 构建并启动调试';
        _debugItem.command = 'compilot.qt.debug';
    }
    _debugItem.show();
}

function _updateSdkDisplay(): void {
    const name = _sdkProjectName || 'No Project';
    const mode = _sdkMode === 'debug' ? 'Debug' : 'Release';
    const isWin = process.platform === 'win32';

    if (_sdkIsBuilding) {
        _projectModeItem.text = `$(sync~spin) Building ${name}`;
        _projectModeItem.tooltip = '编译中...';
        _runItem.hide();
    } else {
        _projectModeItem.text = `$(tools) ${name} · ${mode}${isWin ? ' ' + _sdkArch : ''}`;
        _projectModeItem.tooltip = 'Compilot: 点击选择模式/架构、构建操作、切换项目';
        _runItem.text = '$(play)';
        _runItem.tooltip = 'Compilot SDK: Build';
        _runItem.command = 'compilot.sdk.build';
        _runItem.show();
    }
    _projectModeItem.color = _sdkMode === 'debug'
        ? new vscode.ThemeColor('statusBarItem.warningForeground')
        : undefined;
    _projectModeItem.show();

    // SDK 没有 debug 按钮
    _debugItem.hide();
}

export async function showUnifiedActions(): Promise<void> {
    const state = getState();
    const isWin = process.platform === 'win32';
    type Item = vscode.QuickPickItem & { action: string };

    const sep = (label: string): Item => ({ label, kind: vscode.QuickPickItemKind.Separator, action: '' });

    // 模式选项（根据活跃模块）
    let modeItems: Item[];
    if (_activeModule === 'qt') {
        modeItems = isWin ? [
            { label: '$(bug) Debug x86',       description: state.mode === 'debug' && state.arch === 'x86' ? '当前' : '', action: 'qt:mode:debug:x86' },
            { label: '$(bug) Debug x64',       description: state.mode === 'debug' && state.arch === 'x64' ? '当前' : '', action: 'qt:mode:debug:x64' },
            { label: '$(package) Release x86', description: state.mode === 'release' && state.arch === 'x86' ? '当前' : '', action: 'qt:mode:release:x86' },
            { label: '$(package) Release x64', description: state.mode === 'release' && state.arch === 'x64' ? '当前' : '', action: 'qt:mode:release:x64' }
        ] : [
            { label: '$(bug) Debug',     description: state.mode === 'debug' ? '当前' : '', action: 'qt:mode:debug:x64' },
            { label: '$(package) Release', description: state.mode === 'release' ? '当前' : '', action: 'qt:mode:release:x64' }
        ];
    } else {
        modeItems = isWin ? [
            { label: '$(bug) Debug x86',       description: _sdkMode === 'debug' && _sdkArch === 'x86' ? '当前' : '', action: 'sdk:mode:debug:x86' },
            { label: '$(bug) Debug x64',       description: _sdkMode === 'debug' && _sdkArch === 'x64' ? '当前' : '', action: 'sdk:mode:debug:x64' },
            { label: '$(package) Release x86', description: _sdkMode === 'release' && _sdkArch === 'x86' ? '当前' : '', action: 'sdk:mode:release:x86' },
            { label: '$(package) Release x64', description: _sdkMode === 'release' && _sdkArch === 'x64' ? '当前' : '', action: 'sdk:mode:release:x64' }
        ] : [
            { label: '$(bug) Debug',     description: _sdkMode === 'debug' ? '当前' : '', action: 'sdk:mode:debug:x64' },
            { label: '$(package) Release', description: _sdkMode === 'release' ? '当前' : '', action: 'sdk:mode:release:x64' }
        ];
    }

    // 构建操作
    const buildItems: Item[] = _activeModule === 'qt' ? [
        { label: '$(gear) QMake',   description: '', action: 'qt:qmake' },
        { label: '$(tools) Build',  description: '', action: 'qt:build' },
        { label: '$(package) RCC',  description: '', action: 'qt:rcc' },
        { label: '$(trash) Clean',  description: '', action: 'qt:clean' }
    ] : [
        { label: '$(tools) Build',    description: '', action: 'sdk:build' },
        { label: '$(tools) Rebuild',  description: '', action: 'sdk:rebuild' },
        { label: '$(trash) Clean',    description: '', action: 'sdk:clean' }
    ];

    // 自定义命令（仅 Qt）
    const customCmds = _activeModule === 'qt' ? getCustomCommands() : [];
    const customItems: Item[] = customCmds.map((cmd, i) => ({
        label: `$(terminal) ${cmd.name}`, description: '', action: `qt:custom:${i}`
    }));

    // 项目选择 + 模块切换（合并为一个分组）
    const projectItems: Item[] = _activeModule === 'qt'
        ? [{ label: '$(list-tree) 选择 Qt 项目...', description: '', action: 'qt:selectProject' }]
        : [{ label: '$(list-tree) 选择 SDK 项目...', description: '', action: 'sdk:selectProject' }];

    const moduleItems: Item[] = [
        { label: '$(folder) 切换到 Qt 模块',  description: _activeModule === 'qt' ? '当前' : '', action: 'switch:qt' },
        { label: '$(folder) 切换到 SDK 模块', description: _activeModule === 'sdk' ? '当前' : '', action: 'switch:sdk' }
    ];

    const currentName = _activeModule === 'qt'
        ? getEffectiveProjectName(state.currentProject, getTarget(), '未选择项目')
        : (_sdkProjectName || 'No Project');
    const currentMode = _activeModule === 'qt'
        ? getModeDisplayLabel(state.mode, state.arch, isWin)
        : `${_sdkMode === 'debug' ? 'Debug' : 'Release'}${isWin ? ' ' + _sdkArch : ''}`;

    const pickItems: Item[] = [
        sep('模式'),
        ...modeItems,
        sep('构建'),
        ...buildItems,
        ...(customItems.length > 0 ? [sep('自定义'), ...customItems] : []),
        sep('项目'),
        ...projectItems,
        ...moduleItems
    ];

    const moduleLabel = _activeModule === 'qt' ? 'Qt' : 'SDK';

    const selected = await vscode.window.showQuickPick(
        pickItems,
        { placeHolder: `[${moduleLabel}] ${currentName} · ${currentMode}` }
    ) as Item | undefined;

    if (!selected?.action) { return; }

    // 处理选择
    if (selected.action.startsWith('qt:mode:')) {
        const [, , m, a] = selected.action.split(':');
        setActiveModule('qt');
        const changed = state.mode !== m || state.arch !== a;
        setState('mode', m as BuildMode);
        setState('arch', a as Arch);
        if (changed) { await vscode.commands.executeCommand('compilot.qt.qmake'); }
    } else if (selected.action.startsWith('sdk:mode:')) {
        const [, , m, a] = selected.action.split(':');
        setActiveModule('sdk');
        _sdkMode = m;
        _sdkArch = a;
        // 持久化 SDK mode/arch
        const { setSdkSetting } = await import('../core/settingsStore');
        setSdkSetting('mode', m as 'debug' | 'release');
        setSdkSetting('arch', a as 'x86' | 'x64');
        _sdkUpdateListeners.forEach(fn => fn());
        _updateDisplay();
    } else if (selected.action === 'qt:qmake') { vscode.commands.executeCommand('compilot.qt.qmake'); }
    else if (selected.action === 'qt:build') { vscode.commands.executeCommand('compilot.qt.build'); }
    else if (selected.action === 'qt:rcc') { vscode.commands.executeCommand('compilot.qt.rcc'); }
    else if (selected.action === 'qt:clean') { vscode.commands.executeCommand('compilot.qt.clean'); }
    else if (selected.action === 'sdk:build') { vscode.commands.executeCommand('compilot.sdk.build'); }
    else if (selected.action === 'sdk:rebuild') { vscode.commands.executeCommand('compilot.sdk.rebuild'); }
    else if (selected.action === 'sdk:clean') { vscode.commands.executeCommand('compilot.sdk.clean'); }
    else if (selected.action.startsWith('qt:custom:')) {
        const idx = parseInt(selected.action.split(':')[2], 10);
        const cmd = customCmds[idx];
        if (cmd) { vscode.commands.executeCommand('compilot.qt.runCustomCommand', cmd.name, cmd.command); }
    } else if (selected.action === 'qt:selectProject') { vscode.commands.executeCommand('compilot.qt.selectProject'); }
    else if (selected.action === 'sdk:selectProject') { vscode.commands.executeCommand('compilot.sdk.showActions'); }
    else if (selected.action === 'switch:qt') { setActiveModule('qt'); }
    else if (selected.action === 'switch:sdk') { setActiveModule('sdk'); }
}
