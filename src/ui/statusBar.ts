import * as vscode from 'vscode';
import { getState, setState, onStateChange, BuildMode, Arch } from '../core/stateManager';

// 3 个状态栏按钮
let _projectModeItem: vscode.StatusBarItem;
let _runItem: vscode.StatusBarItem;
let _debugItem: vscode.StatusBarItem;

export function createStatusBar(context: vscode.ExtensionContext): void {
    _projectModeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 113);
    _projectModeItem.command = 'qtPilot.showActions';
    context.subscriptions.push(_projectModeItem);

    _runItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 112);
    context.subscriptions.push(_runItem);

    _debugItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 111);
    _debugItem.command = 'qtPilot.debug';
    _debugItem.text = '$(debug-alt) Debug';
    _debugItem.tooltip = '构建并启动调试';
    context.subscriptions.push(_debugItem);

    context.subscriptions.push(onStateChange(() => _updateDisplay()));
    _updateDisplay();
}

function _modeIcon(): string {
    return '$(tools)';
}

function _modeShortLabel(): string {
    const state = getState();
    const mode = state.mode === 'debug' ? 'D' : 'R';
    if (process.platform !== 'win32') {
        return mode;
    }
    return `${mode}${state.arch === 'x64' ? '64' : '32'}`;
}

function _updateDisplay(): void {
    const state = getState();
    const projectName = state.currentProject?.target ?? '未选择项目';
    _projectModeItem.text = `${_modeIcon()} ${projectName} · ${_modeShortLabel()}`;
    _projectModeItem.tooltip = '点击选择模式/架构、构建操作、切换项目';
    _projectModeItem.color = state.mode === 'debug'
        ? new vscode.ThemeColor('statusBarItem.warningForeground')
        : undefined;
    _projectModeItem.show();

    if (state.isBuilding) {
        _runItem.text = '$(sync~spin) Compiling';
        _runItem.tooltip = '正在编译，完成后可运行或调试';
        _runItem.command = undefined;
    } else if (state.isRunning) {
        _runItem.text = '$(debug-stop) Stop';
        _runItem.tooltip = '终止程序';
        _runItem.command = 'qtPilot.stop';
    } else {
        _runItem.text = '$(play) Run';
        _runItem.tooltip = '构建并运行';
        _runItem.command = 'qtPilot.run';
    }
    _runItem.show();

    if (state.isBuilding) {
        _debugItem.text = '$(sync~spin) Debug';
        _debugItem.tooltip = '正在构建，完成后可调试';
        _debugItem.command = undefined;
        _debugItem.show();
    } else {
        _debugItem.text = '$(debug-alt) Debug';
        _debugItem.tooltip = '构建并启动调试';
        _debugItem.command = 'qtPilot.debug';
        _debugItem.show();
    }
}

export async function showActions(): Promise<void> {
    const state = getState();
    const isWin = process.platform === 'win32';
    type Item = vscode.QuickPickItem & { action: string };

    const modeItems: Item[] = isWin ? [
        { label: '$(bug) Debug x86',       description: state.mode === 'debug' && state.arch === 'x86' ? '当前' : '', action: 'mode:debug:x86' },
        { label: '$(bug) Debug x64',       description: state.mode === 'debug' && state.arch === 'x64' ? '当前' : '', action: 'mode:debug:x64' },
        { label: '$(package) Release x86', description: state.mode === 'release' && state.arch === 'x86' ? '当前' : '', action: 'mode:release:x86' },
        { label: '$(package) Release x64', description: state.mode === 'release' && state.arch === 'x64' ? '当前' : '', action: 'mode:release:x64' }
    ] : [
        { label: '$(bug) Debug',     description: state.mode === 'debug' ? '当前' : '', action: 'mode:debug:x64' },
        { label: '$(package) Release', description: state.mode === 'release' ? '当前' : '', action: 'mode:release:x64' }
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
        { placeHolder: `${state.currentProject?.target ?? '未选择项目'} · ${_modeShortLabel()}` }
    ) as Item | undefined;

    if (!selected?.action) { return; }

    if (selected.action.startsWith('mode:')) {
        const [, m, a] = selected.action.split(':');
        setState('mode', m as BuildMode);
        setState('arch', a as Arch);
    } else if (selected.action === 'qmake') {
        vscode.commands.executeCommand('qtPilot.qmake');
    } else if (selected.action === 'build') {
        vscode.commands.executeCommand('qtPilot.build');
    } else if (selected.action === 'clean') {
        vscode.commands.executeCommand('qtPilot.clean');
    } else if (selected.action === 'selectProject') {
        vscode.commands.executeCommand('qtPilot.selectProject');
    }
}
