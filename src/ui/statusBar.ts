/**
 * 状态栏 — Qt 和 C++ 共用一套 status bar item。
 *
 * 显示当前活跃模块的项目名 + 构建模式，点击弹出 quick menu。
 * play 按钮根据活跃模块执行 run（Qt）或 build（C++）。
 */
import * as vscode from 'vscode';
import { getState, setState, onStateChange, BuildMode, Arch } from '../vscode/qtState';
import { onSettingsChange } from '../vscode/settingsStore';
import { getTarget, getCustomCommands, getWorkspaceRoot } from '../qt/services/configService';
import { getEffectiveProjectName } from '../qt/project/projectDisplay';
import { getModeDisplayLabel } from './statusBarLabels';

export type ActiveModule = 'qt' | 'cpp';

let _activeModule: ActiveModule = 'qt';
let _projectModeItem: vscode.StatusBarItem;
let _runItem: vscode.StatusBarItem;
let _debugItem: vscode.StatusBarItem;

// C++ state references (set by C++ module after init)
let _cppProjectName: string = '';
let _cppMode: string = 'debug';
let _cppArch: string = 'x86';
let _cppIsBuilding: boolean = false;
const _cppUpdateListeners: ((update: { mode: string; arch: string }) => void)[] = [];

export function getActiveModule(): ActiveModule { return _activeModule; }
export function setActiveModule(m: ActiveModule): void {
    _activeModule = m;
    _updateDisplay();
}

/** Switch activeTarget to match the selected module by finding a target of that kind in workspaceStore.
 *  Returns true if a matching target was found, false if no saved target of that kind exists. */
function _syncActiveTarget(kind: ActiveModule): boolean {
    const { resolveWorkroot, loadWorkspaceConfig, saveWorkspaceConfig } = require('../core/workspaceStore');
    const workspace = getWorkspaceRoot() || process.cwd();
    const workroot = resolveWorkroot(workspace);
    if (!workroot) { return false; }

    const config = loadWorkspaceConfig(workroot);
    // Find a target of the requested kind
    const targets = config.targets as Record<string, { id: string; kind: string }>;
    const target = Object.values(targets).find(t => t.kind === kind);
    if (!target) { return false; }

    config.activeTarget = target.id;
    try { saveWorkspaceConfig(config); } catch { return false; }
    return true;
}

export function getRunStatusBarItem(): vscode.StatusBarItem { return _runItem; }

// C++ 模块调用这些函数来更新状态栏
export function setCppState(opts: { projectName?: string; mode?: string; arch?: string; isBuilding?: boolean }): void {
    if (opts.projectName !== undefined) { _cppProjectName = opts.projectName; }
    if (opts.mode !== undefined) { _cppMode = opts.mode; }
    if (opts.arch !== undefined) { _cppArch = opts.arch; }
    if (opts.isBuilding !== undefined) { _cppIsBuilding = opts.isBuilding; }
    if (_activeModule === 'cpp') { _updateDisplay(); }
}

export function onCppUpdate(fn: (update: { mode: string; arch: string }) => void): vscode.Disposable {
    _cppUpdateListeners.push(fn);
    return new vscode.Disposable(() => {
        const idx = _cppUpdateListeners.indexOf(fn);
        if (idx >= 0) { _cppUpdateListeners.splice(idx, 1); }
    });
}

export function createStatusBar(context: vscode.ExtensionContext): void {
    _projectModeItem = vscode.window.createStatusBarItem('forja.projectMode', vscode.StatusBarAlignment.Left, 113);
    _projectModeItem.name = 'Forja: Project';
    _projectModeItem.command = 'forja._showActions';
    context.subscriptions.push(_projectModeItem);

    _runItem = vscode.window.createStatusBarItem('forja.run', vscode.StatusBarAlignment.Left, 112);
    _runItem.name = 'Forja: Run/Build';
    context.subscriptions.push(_runItem);

    _debugItem = vscode.window.createStatusBarItem('forja.debug', vscode.StatusBarAlignment.Left, 111);
    _debugItem.name = 'Forja: Debug';
    _debugItem.command = 'forja.debug';
    _debugItem.text = '$(debug-alt)';
    _debugItem.tooltip = '构建并启动调试';
    context.subscriptions.push(_debugItem);

    context.subscriptions.push(new vscode.Disposable(onStateChange(() => {
        if (_activeModule === 'qt') { _updateDisplay(); }
    })));

    // target/mode/arch 等设置变化时也刷新状态栏
    context.subscriptions.push(onSettingsChange((section, key) => {
        if (section === 'qt' && (key === 'target' || key === 'mode' || key === 'arch')) {
            if (_activeModule === 'qt') { _updateDisplay(); }
        }
    }));

    // 注册内部 showActions 命令（状态栏专用）
    context.subscriptions.push(
        vscode.commands.registerCommand('forja._showActions', () => showActions())
    );

    _updateDisplay();
}

function _updateDisplay(): void {
    if (_activeModule === 'qt') {
        _updateQtDisplay();
    } else {
        _updateCppDisplay();
    }
}

function _updateQtDisplay(): void {
    const state = getState();
    const projectName = getEffectiveProjectName(state.currentProject, getTarget(), '未选择项目');
    const modeLabel = getModeDisplayLabel(state.mode, state.arch, process.platform === 'win32');
    _projectModeItem.text = `$(tools) [Qt] ${projectName} · ${modeLabel}`;
    _projectModeItem.tooltip = 'Forja Qt 模式 — 点击切换模块/模式/项目';
    _projectModeItem.color = state.mode === 'debug'
        ? new vscode.ThemeColor('statusBarItem.warningForeground')
        : undefined;
    _projectModeItem.show();

    if (state.isBuilding && state.buildAction === 'run') {
        _runItem.text = '$(sync~spin)';
        _runItem.tooltip = 'Forja: 正在为运行编译';
        _runItem.command = undefined;
    } else if (state.isRunning) {
        _runItem.text = '$(debug-stop)';
        _runItem.tooltip = 'Forja: 终止程序';
        _runItem.command = 'forja.stop';
    } else {
        _runItem.text = '$(play)';
        _runItem.tooltip = 'Forja: 构建并运行';
        _runItem.command = 'forja.run';
    }
    _runItem.show();

    if (state.isBuilding && state.buildAction === 'debug') {
        _debugItem.text = '$(sync~spin)';
        _debugItem.tooltip = 'Forja: 正在为调试编译';
        _debugItem.command = undefined;
    } else {
        _debugItem.text = '$(debug-alt)';
        _debugItem.tooltip = 'Forja: 构建并启动调试';
        _debugItem.command = 'forja.debug';
    }
    _debugItem.show();
}

function _updateCppDisplay(): void {
    const name = _cppProjectName || 'No Project';
    const mode = _cppMode === 'debug' ? 'Debug' : 'Release';
    const isWin = process.platform === 'win32';

    if (_cppIsBuilding) {
        _projectModeItem.text = `$(sync~spin) Building ${name}`;
        _projectModeItem.tooltip = '编译中...';
        _runItem.hide();
    } else {
        _projectModeItem.text = `$(tools) [C++] ${name} · ${mode}${isWin ? ' ' + _cppArch : ''}`;
        _projectModeItem.tooltip = 'Forja C++ 模式 — 点击切换模块/模式/项目';
        _runItem.text = '$(play)';
        _runItem.tooltip = 'Forja C++: Build';
        _runItem.command = 'forja.build';
        _runItem.show();
    }
    _projectModeItem.color = _cppMode === 'debug'
        ? new vscode.ThemeColor('statusBarItem.warningForeground')
        : undefined;
    _projectModeItem.show();

    // C++ 没有 debug 按钮
    _debugItem.hide();
}

/**
 * 将 mode/arch 变更同步写入 activeTarget 文件，
 * 确保后续 forja.build 读到正确的 mode/arch。
 */
function _syncActiveTargetModeArch(mode: BuildMode, arch: Arch): void {
    const ws = getWorkspaceRoot();
    if (!ws) { return; }
    const { resolveWorkroot, loadWorkspaceConfig, saveWorkspaceConfig, getActiveTarget } = require('../core/workspaceStore');
    const workroot = resolveWorkroot(ws);
    if (!workroot) { return; }
    const config = loadWorkspaceConfig(workroot);
    const profile = getActiveTarget(config);
    if (!profile) { return; }
    if (profile.mode === mode && profile.arch === arch) { return; }
    profile.mode = mode;
    profile.arch = arch;
    try { saveWorkspaceConfig(config); } catch { /* ignore — status bar sync is best-effort */ }
}

function _syncCppModeArch(mode: string, arch: string): void {
    const ws = getWorkspaceRoot() || process.cwd();
    if (!ws) { return; }
    const { resolveWorkroot, loadWorkspaceConfig, saveWorkspaceConfig, getActiveTarget } = require('../core/workspaceStore');
    const workroot = resolveWorkroot(ws);
    if (!workroot) { return; }
    const config = loadWorkspaceConfig(workroot);
    const profile = getActiveTarget(config);
    if (!profile || profile.kind !== 'cpp') { return; }
    if (profile.mode === mode && profile.arch === arch) { return; }
    profile.mode = mode as 'debug' | 'release';
    profile.arch = arch as 'x86' | 'x64';
    try { saveWorkspaceConfig(config); } catch { /* best-effort */ }
}

export async function showActions(): Promise<void> {
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
            { label: '$(bug) Debug x86',       description: _cppMode === 'debug' && _cppArch === 'x86' ? '当前' : '', action: 'cpp:mode:debug:x86' },
            { label: '$(bug) Debug x64',       description: _cppMode === 'debug' && _cppArch === 'x64' ? '当前' : '', action: 'cpp:mode:debug:x64' },
            { label: '$(package) Release x86', description: _cppMode === 'release' && _cppArch === 'x86' ? '当前' : '', action: 'cpp:mode:release:x86' },
            { label: '$(package) Release x64', description: _cppMode === 'release' && _cppArch === 'x64' ? '当前' : '', action: 'cpp:mode:release:x64' }
        ] : [
            { label: '$(bug) Debug',     description: _cppMode === 'debug' ? '当前' : '', action: 'cpp:mode:debug:x64' },
            { label: '$(package) Release', description: _cppMode === 'release' ? '当前' : '', action: 'cpp:mode:release:x64' }
        ];
    }

    // 构建操作
    const buildItems: Item[] = _activeModule === 'qt' ? [
        { label: '$(gear) QMake',   description: '', action: 'qt:qmake' },
        { label: '$(tools) Build',  description: '', action: 'qt:build' },
        { label: '$(package) RCC',  description: '', action: 'qt:rcc' },
        { label: '$(trash) Clean',  description: '', action: 'qt:clean' }
    ] : [
        { label: '$(tools) Build',    description: '', action: 'cpp:build' },
        { label: '$(tools) Rebuild',  description: '', action: 'cpp:rebuild' },
        { label: '$(trash) Clean',    description: '', action: 'cpp:clean' }
    ];

    // 自定义命令（仅 Qt）
    const customCmds = _activeModule === 'qt' ? getCustomCommands() : [];
    const customItems: Item[] = customCmds.map((cmd, i) => ({
        label: `$(terminal) ${cmd.name}`, description: '', action: `qt:custom:${i}`
    }));

    // 项目选择 + 模块切换（合并为一个分组）
    const projectItems: Item[] = _activeModule === 'qt'
        ? [{ label: '$(list-tree) 选择 Qt 项目...', description: '', action: 'qt:selectProject' }]
        : [{ label: '$(list-tree) 选择 C++ 项目...', description: '', action: 'cpp:selectProject' }];

    const moduleItems: Item[] = [
        { label: '$(folder) 切换到 Qt 模块',  description: _activeModule === 'qt' ? '当前' : '', action: 'switch:qt' },
        { label: '$(folder) 切换到 C++ 模块', description: _activeModule === 'cpp' ? '当前' : '', action: 'switch:cpp' }
    ];

    const currentName = _activeModule === 'qt'
        ? getEffectiveProjectName(state.currentProject, getTarget(), '未选择项目')
        : (_cppProjectName || 'No Project');
    const currentMode = _activeModule === 'qt'
        ? getModeDisplayLabel(state.mode, state.arch, isWin)
        : `${_cppMode === 'debug' ? 'Debug' : 'Release'}${isWin ? ' ' + _cppArch : ''}`;

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

    const moduleLabel = _activeModule === 'qt' ? 'Qt' : 'C++';

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
        if (changed) {
            _syncActiveTargetModeArch(m as BuildMode, a as Arch);
            // Don't auto-run qmake — the next `forja build` will detect Makefile
            // mismatch and run qmake automatically if needed
        }
    } else if (selected.action.startsWith('cpp:mode:')) {
        const [, , m, a] = selected.action.split(':');
        setActiveModule('cpp');
        _cppMode = m;
        _cppArch = a;
        _cppUpdateListeners.forEach(fn => fn({ mode: m, arch: a }));
        _updateDisplay();
        // Persist to workspaceStore (same as Qt path)
        _syncCppModeArch(m, a);
    } else if (selected.action === 'qt:qmake') { vscode.commands.executeCommand('forja.build', 'qmake'); }
    else if (selected.action === 'qt:build') { vscode.commands.executeCommand('forja.build'); }
    else if (selected.action === 'qt:rcc') { vscode.commands.executeCommand('forja.build', 'rcc'); }
    else if (selected.action === 'qt:clean') { vscode.commands.executeCommand('forja.clean'); }
    else if (selected.action === 'cpp:build') { vscode.commands.executeCommand('forja.build'); }
    else if (selected.action === 'cpp:rebuild') { vscode.commands.executeCommand('forja.build', 'fresh'); }
    else if (selected.action === 'cpp:clean') { vscode.commands.executeCommand('forja.clean'); }
    else if (selected.action.startsWith('qt:custom:')) {
        const idx = parseInt(selected.action.split(':')[2], 10);
        const cmd = customCmds[idx];
        if (cmd) { vscode.commands.executeCommand('forja.run', cmd.name, cmd.command); }
    } else if (selected.action === 'qt:selectProject') {
        vscode.commands.executeCommand('forja._selectTarget', 'qt');
    }
    else if (selected.action === 'cpp:selectProject') {
        vscode.commands.executeCommand('forja._selectTarget', 'cpp');
    }
    else if (selected.action === 'switch:qt') {
        if (_syncActiveTarget('qt')) { setActiveModule('qt'); }
        else { vscode.commands.executeCommand('forja.list'); }
    }
    else if (selected.action === 'switch:cpp') {
        if (_syncActiveTarget('cpp')) { setActiveModule('cpp'); }
        else { vscode.commands.executeCommand('forja.list'); }
    }
}
