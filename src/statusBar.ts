import * as vscode from 'vscode';
import { ProjectInfo } from './projectManager';

export type BuildMode = 'debug' | 'release';
export type Arch = 'x86' | 'x64';

let _mode: BuildMode = 'debug';
let _arch: Arch = 'x86';
let _isBuilding = false;
let _isRunning = false;
let _currentProject: ProjectInfo | null = null;

// 3 个状态栏按钮
let _projectModeItem: vscode.StatusBarItem;  // 项目+模式，含操作菜单
let _runItem: vscode.StatusBarItem;          // Run / Stop
let _debugItem: vscode.StatusBarItem;        // Debug

export function getMode(): BuildMode { return _mode; }
export function getArch(): Arch { return _arch; }
export function isRunning(): boolean { return _isRunning; }

export function createStatusBar(context: vscode.ExtensionContext): void {
    _projectModeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 113);
    _projectModeItem.command = 'xyQt.showActions';
    context.subscriptions.push(_projectModeItem);

    _runItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 112);
    context.subscriptions.push(_runItem);

    _debugItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 111);
    _debugItem.command = 'xyQt.debug';
    _debugItem.text = '$(debug-alt) Debug';
    _debugItem.tooltip = '构建并启动调试';
    context.subscriptions.push(_debugItem);

    _updateDisplay();
}

export function setProject(project: ProjectInfo | null): void {
    _currentProject = project;
    _updateDisplay();
}

export function setBuilding(building: boolean): void {
    _isBuilding = building;
    _updateDisplay();
}

export function setRunning(running: boolean): void {
    _isRunning = running;
    _updateDisplay();
}

function _modeIcon(): string {
    return _mode === 'debug' ? '$(bug)' : '$(package)';
}

function _updateDisplay(): void {
    // 按钮1：项目 · 模式 架构
    const projectName = _currentProject?.target ?? '未选择项目';
    const modeLabel = `${_mode === 'debug' ? 'Debug' : 'Release'} ${_arch}`;
    _projectModeItem.text = `${_modeIcon()} ${projectName} · ${modeLabel}`;
    _projectModeItem.tooltip = '点击选择模式/架构、构建操作、切换项目';
    _projectModeItem.color = _mode === 'debug'
        ? new vscode.ThemeColor('statusBarItem.warningForeground')
        : undefined;
    _projectModeItem.show();

    // 按钮2：Run / 构建中 / Stop
    if (_isBuilding) {
        _runItem.text = '$(loading~spin) 构建中...';
        _runItem.tooltip = '正在构建';
        _runItem.command = undefined;
    } else if (_isRunning) {
        _runItem.text = '$(debug-stop) Stop';
        _runItem.tooltip = '终止程序';
        _runItem.command = 'xyQt.stop';
    } else {
        _runItem.text = '$(play) Run';
        _runItem.tooltip = '构建并运行';
        _runItem.command = 'xyQt.run';
    }
    _runItem.show();

    // 按钮3：Debug（构建中隐藏）
    if (_isBuilding) {
        _debugItem.hide();
    } else {
        _debugItem.show();
    }
}

export async function showActions(): Promise<void> {
    type Item = vscode.QuickPickItem & { action: string };

    const modeItems: Item[] = [
        { label: '$(bug) Debug x86',       description: _mode === 'debug' && _arch === 'x86' ? '当前' : '', action: 'mode:debug:x86' },
        { label: '$(bug) Debug x64',       description: _mode === 'debug' && _arch === 'x64' ? '当前' : '', action: 'mode:debug:x64' },
        { label: '$(package) Release x86', description: _mode === 'release' && _arch === 'x86' ? '当前' : '', action: 'mode:release:x86' },
        { label: '$(package) Release x64', description: _mode === 'release' && _arch === 'x64' ? '当前' : '', action: 'mode:release:x64' }
    ];

    const buildItems: Item[] = [
        { label: '$(gear) QMake',   description: '', action: 'qmake' },
        { label: '$(tools) Build',  description: '', action: 'build' },
        { label: '$(trash) Clean',  description: '', action: 'clean' }
    ];

    const projectItems: Item[] = [
        { label: '$(folder) 切换项目...', description: '', action: 'selectProject' }
    ];

    const sep = (label: string): Item => ({ label, kind: vscode.QuickPickItemKind.Separator, action: '' });

    const selected = await vscode.window.showQuickPick(
        [
            sep('模式'),
            ...modeItems,
            sep('构建'),
            ...buildItems,
            sep('项目'),
            ...projectItems
        ],
        { placeHolder: `${_currentProject?.target ?? '未选择项目'} · ${_mode === 'debug' ? 'Debug' : 'Release'} ${_arch}` }
    ) as Item | undefined;

    if (!selected?.action) { return; }

    if (selected.action.startsWith('mode:')) {
        const [, m, a] = selected.action.split(':');
        _mode = m as BuildMode;
        _arch = a as Arch;
        _updateDisplay();
    } else if (selected.action === 'qmake') {
        vscode.commands.executeCommand('xyQt.qmake');
    } else if (selected.action === 'build') {
        vscode.commands.executeCommand('xyQt.build');
    } else if (selected.action === 'clean') {
        vscode.commands.executeCommand('xyQt.clean');
    } else if (selected.action === 'selectProject') {
        vscode.commands.executeCommand('xyQt.selectProject');
    }
}
