import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getBuildConfig, getQtSourcePath } from '../../core/configService';
import { setState } from '../../core/stateManager';
import { getMakefileInfo } from '../project/projectManager';
import { build, qmakeForDebug, stopCurrentTarget } from './buildManager';
import { createLogger } from '../../core/logger';

const isWin = process.platform === 'win32';
const logger = createLogger('Debug');
let _activeDebugProgram: string | null = null;
let _suppressTerminateNotice = false;

function getEffectiveQtSourcePath(qtPath: string): string {
    const manualPath = getQtSourcePath().trim();
    if (manualPath && fs.existsSync(manualPath)) {
        return manualPath;
    }

    if (!qtPath) {
        return '';
    }

    const candidates = [
        path.join(qtPath, 'Src'),
        path.join(path.dirname(qtPath), 'Src'),
        path.join(path.dirname(path.dirname(qtPath)), 'Src')
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return '';
}

function createQtSourceFileMap(qtSourcePath: string): Record<string, string> | undefined {
    if (!qtSourcePath || !fs.existsSync(qtSourcePath)) {
        return undefined;
    }

    const moduleDirs = fs.readdirSync(qtSourcePath, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.toLowerCase().startsWith('qt'))
        .map(entry => entry.name);
    if (moduleDirs.length === 0) {
        return undefined;
    }

    const commonRoots = [
        'C:\\Qt',
        'D:\\Qt',
        'E:\\Qt',
        'C:\\work',
        'D:\\work',
        'E:\\work',
        'C:\\Users\\qt\\work',
        'D:\\Users\\qt\\work',
        'E:\\Users\\qt\\work',
        'C:\\a\\_work\\1\\s',
        'D:\\a\\_work\\1\\s',
        'E:\\a\\_work\\1\\s'
    ];
    const sourceRootNames = ['Src', 'src', 'qt5', 'qt6', 'qt', 'install\\src'];
    const sourceFileMap: Record<string, string> = {};

    for (const moduleDir of moduleDirs) {
        const localModulePath = path.join(qtSourcePath, moduleDir);
        sourceFileMap[localModulePath] = localModulePath;
        for (const root of commonRoots) {
            sourceFileMap[path.join(root, moduleDir)] = localModulePath;
            for (const rootName of sourceRootNames) {
                sourceFileMap[path.join(root, rootName, moduleDir)] = localModulePath;
            }
        }
    }

    return Object.keys(sourceFileMap).length > 0 ? sourceFileMap : undefined;
}

async function waitForTask(execution: vscode.TaskExecution): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (exitCode: number | undefined) => {
            if (settled) { return; }
            settled = true;
            d1.dispose();
            d2.dispose();
            if (exitCode === 0) { resolve(); }
            else { reject(new Error(exitCode === undefined ? '任务已终止' : '任务失败')); }
        };
        const d1 = vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution === execution) { finish(e.exitCode); }
        });
        const d2 = vscode.tasks.onDidEndTask(e => {
            if (e.execution === execution) { finish(undefined); }
        });
    });
}

async function stopExistingDebugSessions(program: string): Promise<void> {
    const session = vscode.debug.activeDebugSession;
    const targetProgram = session?.configuration?.program;
    if (!session || typeof targetProgram !== 'string' || path.normalize(targetProgram) !== path.normalize(program)) {
        return;
    }

    vscode.window.showInformationMessage('检测到现有调试实例，已先停止后重新启动');
    _suppressTerminateNotice = true;
    await vscode.debug.stopDebugging(session);

    await new Promise<void>(resolve => {
        const check = (): void => {
            const activeSession = vscode.debug.activeDebugSession;
            const activeProgram = activeSession?.configuration?.program;
            const stillRunning = !!activeSession
                && typeof activeProgram === 'string'
                && path.normalize(activeProgram) === path.normalize(program);
            if (!stillRunning) {
                _suppressTerminateNotice = false;
                resolve();
                return;
            }
            setTimeout(check, 100);
        };
        check();
    });
}

export function registerDebugSessionWatcher(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.debug.onDidTerminateDebugSession(session => {
            const targetProgram = session.configuration?.program;
            if (typeof targetProgram !== 'string' || !_activeDebugProgram) {
                return;
            }
            if (path.normalize(targetProgram) !== path.normalize(_activeDebugProgram)) {
                return;
            }

            logger.warn(`调试会话结束: ${targetProgram}`);
            _activeDebugProgram = null;

            if (_suppressTerminateNotice) {
                return;
            }

            void vscode.commands.executeCommand('workbench.debug.action.toggleRepl');
            vscode.window.showWarningMessage('调试会话已结束，程序可能已崩溃或已退出，请查看“调试控制台”获取更多信息');
        })
    );
}

export async function startDebug(): Promise<void> {
    const cfg = getBuildConfig();
    if (!cfg.projectDir) {
        vscode.window.showErrorMessage('请先选择项目');
        return;
    }

    // 先 Build
    setState('isBuilding', true);
    setState('buildAction', 'debug');
    try {
        if (cfg.mode === 'release') {
            const qmakeExecution = await qmakeForDebug();
            await waitForTask(qmakeExecution);
        }
        const buildExecution = await build();
        await waitForTask(buildExecution);
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(message === '任务失败' ? '构建失败' : message);
        return;
    } finally {
        setState('isBuilding', false);
        setState('buildAction', null);
    }

    const mfInfo = getMakefileInfo(cfg.projectDir, cfg.mode, cfg.arch);
    if (!mfInfo) {
        vscode.window.showErrorMessage(`请先运行 QMake (${cfg.mode})`);
        return;
    }

    await stopExistingDebugSessions(mfInfo.exePath);
    stopCurrentTarget();

    const qtSourcePath = getEffectiveQtSourcePath(cfg.qtPath);
    const sourceFileMap = createQtSourceFileMap(qtSourcePath);

    const config: vscode.DebugConfiguration = {
        name: `Debug ${mfInfo.target}`,
        type: isWin ? 'cppvsdbg' : 'cppdbg',
        request: 'launch',
        program: mfInfo.exePath,
        args: [],
        stopAtEntry: false,
        cwd: cfg.projectDir,
        environment: [],
        externalConsole: false,
        logging: {
            exceptions: true,
            programOutput: true
        }
    };
    if (sourceFileMap) {
        config.sourceFileMap = sourceFileMap;
    }

    try {
        logger.info(`启动调试: ${mfInfo.exePath}`);
        await vscode.debug.startDebugging(undefined, config);
        _activeDebugProgram = mfInfo.exePath;
    } catch (e) {
        vscode.window.showErrorMessage(`启动调试失败: ${e}`);
    }
}
