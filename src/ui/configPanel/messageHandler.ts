import * as vscode from 'vscode';
import { detectEnv } from '../../env/envDetector';
import { generateCppProperties, updateCppPropertiesStandard } from '../../build/configGenerator';
import { getState, setState } from '../../core/stateManager';
import { updateConfig, getQtPath, getVsDevShellPath } from '../../core/configService';
import { createLogger } from '../../core/logger';

const logger = createLogger('ConfigPanel');

export async function handleMessage(
    msg: any,
    webview: vscode.Webview,
    pushEnvUpdate: () => void,
    updateHtml: () => void
): Promise<void> {
    logger.info(`收到消息: ${msg.command}`);

    switch (msg.command) {
        case 'refreshEnv': {
            const env = await detectEnv(getQtPath(), getVsDevShellPath());
            setState('envInfo', env);
            pushEnvUpdate();
            break;
        }
        case 'selectProject': {
            await vscode.commands.executeCommand('qtPilot.selectProject');
            updateHtml();
            break;
        }
        case 'saveVsPath': {
            logger.info(`保存 VS 路径: "${msg.value}"`);
            await updateConfig('vsDevShellPath', msg.value || '');
            webview.postMessage({ command: 'envDetecting' });
            const qtPath = getQtPath();
            const env = await detectEnv(qtPath, msg.value || '');
            setState('envInfo', env);
            pushEnvUpdate();
            break;
        }
        case 'saveQtPath': {
            logger.info(`保存 Qt 路径: "${msg.value}"`);
            await updateConfig('qtPath', msg.value || '');
            webview.postMessage({ command: 'envDetecting' });
            const vsPath = getVsDevShellPath();
            const env = await detectEnv(msg.value || '', vsPath);
            setState('envInfo', env);
            pushEnvUpdate();
            break;
        }
        case 'saveDesignerPath': {
            logger.info(`保存 Designer 路径: "${msg.value}"`);
            await updateConfig('designerPath', msg.value || '');
            break;
        }
        case 'saveQtSourcePath': {
            logger.info(`保存 Qt 源码路径: "${msg.value}"`);
            await updateConfig('qtSourcePath', msg.value || '');
            break;
        }
        case 'saveStandard': {
            logger.info(`保存标准: C=${msg.cStandard}, C++=${msg.cppStandard}`);
            if (msg.cStandard) { await updateConfig('cStandard', msg.cStandard); }
            if (msg.cppStandard) { await updateConfig('cppStandard', msg.cppStandard); }
            updateCppPropertiesStandard(msg.cStandard || 'c11', msg.cppStandard || 'c++11');
            break;
        }
        case 'browse': {
            logger.info(`浏览: targetId=${msg.targetId}, isDir=${msg.isDir}`);
            if (msg.targetId === 'manualProPath') {
                const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, filters: { 'Qt Project': ['pro'] } });
                if (uris?.[0]) {
                    logger.info(`选择 .pro: ${uris[0].fsPath}`);
                    webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
                }
            } else if (msg.isDir) {
                const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true });
                if (uris?.[0]) {
                    logger.info(`选择目录: ${uris[0].fsPath}`);
                    webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
                }
            } else {
                const filters: { [name: string]: string[] } = msg.targetId === 'designerPath'
                    ? { 'Qt Designer': ['exe'] }
                    : { 'PowerShell': ['ps1'] };
                const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, filters });
                if (uris?.[0]) {
                    logger.info(`选择文件: ${uris[0].fsPath}`);
                    webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
                }
            }
            break;
        }
        case 'saveExcludeDirs': {
            logger.info(`保存排除目录: ${JSON.stringify(msg.dirs)}`);
            await updateConfig('scanExcludeDirs', msg.dirs);
            break;
        }
        case 'saveQmakeTarget': {
            logger.info(`保存 QMake TARGET: "${msg.value}"`);
            await updateConfig('qmakeTarget', msg.value || '');
            break;
        }
        case 'saveManualProPath': {
            logger.info(`手动指定 .pro: "${msg.value}"`);
            await updateConfig('manualProPath', msg.value || '');
            if (msg.value) {
                await vscode.commands.executeCommand('qtPilot.loadManualProject');
            }
            updateHtml();
            break;
        }
        case 'generateIntelliSense': {
            logger.info(`生成 IntelliSense: C=${msg.cStandard}, C++=${msg.cppStandard}`);
            if (msg.cStandard) { await updateConfig('cStandard', msg.cStandard); }
            if (msg.cppStandard) { await updateConfig('cppStandard', msg.cppStandard); }
            const project = getState().currentProject;
            if (project) {
                logger.info(`项目: ${project.proFile}`);
                generateCppProperties(project);
            } else {
                logger.warn('无项目，无法生成 IntelliSense');
                vscode.window.showWarningMessage('请先选择项目');
            }
            break;
        }
    }
}
