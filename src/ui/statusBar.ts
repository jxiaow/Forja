import * as vscode from 'vscode';
import { getState, setState, onStateChange, BuildMode, Arch } from '../core/stateManager';
import { getQmakeTarget } from '../core/configService';
import { getEffectiveProjectName } from '../core/projectDisplay';
import { getModeDisplayLabel } from './statusBarLabels';

// 3 个状态栏按钮
let _projectModeItem: vscode.StatusBarItem;
let _runItem: vscode.StatusBarItem;
let _debugItem: vscode.StatusBarItem;

export function createStatusBar(context: vscode.ExtensionContext): void {
    _projectModeItem = vscode.window.createStatusBarItem('qtPilot.projectMode', vscode.StatusBarAlignment.Left, 113);
    _projectModeItem.name = 'Qt Pilot: Project';
    _projectModeItem.command = 'qtPilot.showActions';
    context.subscriptions.push(_projectModeItem);

    _runItem = vscode.window.createStatusBarItem('qtPilot.run', vscode.StatusBarAlignment.Left, 112);
    _runItem.name = 'Qt Pilot: Run';
    context.subscriptions.push(_runItem);

    _debugItem = vscode.window.createStatusBarItem('qtPilot.debug', vscode.StatusBarAlignment.Left, 111);
    _debugItem.name = 'Qt Pilot: Debug';
    _debugItem.command = 'qtPilot.debug';
    _debugItem.text = '$(debug-alt)';
    _debugItem.tooltip = '构建并启动调试';
    context.subscriptions.push(_debugItem);

    context.subscriptions.push(onStateChange(() => _updateDisplay()));
    _updateDisplay();
}

function _modeIcon(): string {
    return '$(tools)';
}

function _modeDisplayLabel(): string {
    const state = getState();
    return getModeDisplayLabel(state.mode, state.arch, process.platform === 'win32');
}

function _updateDisplay(): void {
    const state = getState();
    const projectName = getEffectiveProjectName(state.currentProject, getQmakeTarget(), '未选择项目');
    _projectModeItem.text = `${_modeIcon()} ${projectName} · ${_modeDisplayLabel()}`;
    _projectModeItem.tooltip = 'Qt Pilot: 点击选择模式/架构、构建操作、切换项目';
    _projectModeItem.color = state.mode === 'debug'
        ? new vscode.ThemeColor('statusBarItem.warningForeground')
        : undefined;
    _projectModeItem.show();

    if (state.isBuilding && state.buildAction === 'run') {
        _runItem.text = '$(sync~spin)';
        _runItem.tooltip = 'Qt Pilot: 正在为运行编译';
        _runItem.command = undefined;
    } else if (state.isRunning) {
        _runItem.text = '$(debug-stop)';
        _runItem.tooltip = 'Qt Pilot: 终止程序';
        _runItem.command = 'qtPilot.stop';
    } else {
        _runItem.text = '$(play)';
        _runItem.tooltip = 'Qt Pilot: 构建并运行';
        _runItem.command = 'qtPilot.run';
    }
    _runItem.show();

    if (state.isBuilding && state.buildAction === 'debug') {
        _debugItem.text = '$(sync~spin)';
        _debugItem.tooltip = 'Qt Pilot: 正在为调试编译';
        _debugItem.command = undefined;
    } else {
        _debugItem.text = '$(debug-alt)';
        _debugItem.tooltip = 'Qt Pilot: 构建并启动调试';
        _debugItem.command = 'qtPilot.debug';
    }
    _debugItem.show();
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
        { placeHolder: `${getEffectiveProjectName(state.currentProject, getQmakeTarget(), '未选择项目')} · ${_modeDisplayLabel()}` }
    ) as Item | undefined;

    if (!selected?.action) { return; }

    if (selected.action.startsWith('mode:')) {
        const [, m, a] = selected.action.split(':');
        const changed = state.mode !== m || state.arch !== a;
        setState('mode', m as BuildMode);
        setState('arch', a as Arch);
        if (changed) {
            await vscode.commands.executeCommand('qtPilot.qmake');
        }
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
