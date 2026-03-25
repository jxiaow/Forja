import * as vscode from 'vscode';
import { detectEnv } from '../../env/envDetector';
import { generateCppProperties, updateCppPropertiesStandard } from '../../build/configGenerator';
import { getState, setState } from '../../core/stateManager';
import { updateConfig, getQtPath, getVsDevShellPath } from '../../core/configService';
import { log } from '../../core/logger';

export async function handleMessage(
    msg: any,
    webview: vscode.Webview,
    pushEnvUpdate: () => void,
    updateHtml: () => void
): Promise<void> {
    log(`收到消息: ${msg.command}`);

    switch (msg.command) {
        case 'refreshEnv': {
            const env = await detectEnv(getQtPath(), getVsDevShellPath());
            setState('envInfo', env);
            pushEnvUpdate();
            break;
        }
        case 'selectProject': {
            await vscode.commands.executeCommand('xyQt.selectProject');
            updateHtml();
            break;
        }
        case 'saveVsPath': {
            log(`保存 VS 路径: "${msg.value}"`);
            await updateConfig('vsDevShellPath', msg.value || '');
            webview.postMessage({ command: 'envDetecting' });
            const qtPath = getQtPath();
            const env = await detectEnv(qtPath, msg.value || '');
            setState('envInfo', env);
            pushEnvUpdate();
            break;
        }
        case 'saveQtPath': {
            log(`保存 Qt 路径: "${msg.value}"`);
            await updateConfig('qtPath', msg.value || '');
            webview.postMessage({ command: 'envDetecting' });
            const vsPath = getVsDevShellPath();
            const env = await detectEnv(msg.value || '', vsPath);
            setState('envInfo', env);
            pushEnvUpdate();
            break;
        }
        case 'saveStandard': {
            log(`保存标准: C=${msg.cStandard}, C++=${msg.cppStandard}`);
            if (msg.cStandard) { await updateConfig('cStandard', msg.cStandard); }
            if (msg.cppStandard) { await updateConfig('cppStandard', msg.cppStandard); }
            updateCppPropertiesStandard(msg.cStandard || 'c11', msg.cppStandard || 'c++11');
            break;
        }
        case 'browse': {
            log(`浏览: targetId=${msg.targetId}, isDir=${msg.isDir}`);
            if (msg.targetId === 'manualProPath') {
                const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, filters: { 'Qt Project': ['pro'] } });
                if (uris?.[0]) {
                    log(`选择 .pro: ${uris[0].fsPath}`);
                    webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
                }
            } else if (msg.isDir) {
                const uris = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true });
                if (uris?.[0]) {
                    log(`选择目录: ${uris[0].fsPath}`);
                    webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
                }
            } else {
                const filters: { [name: string]: string[] } = { 'PowerShell': ['ps1'] };
                const uris = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, filters });
                if (uris?.[0]) {
                    log(`选择文件: ${uris[0].fsPath}`);
                    webview.postMessage({ command: 'setPath', targetId: msg.targetId, value: uris[0].fsPath });
                }
            }
            break;
        }
        case 'saveExcludeDirs': {
            log(`保存排除目录: ${JSON.stringify(msg.dirs)}`);
            await updateConfig('scanExcludeDirs', msg.dirs);
            break;
        }
        case 'saveQmakeTarget': {
            log(`保存 QMake TARGET: "${msg.value}"`);
            await updateConfig('qmakeTarget', msg.value || '');
            break;
        }
        case 'saveManualProPath': {
            log(`手动指定 .pro: "${msg.value}"`);
            await updateConfig('manualProPath', msg.value || '');
            if (msg.value) {
                await vscode.commands.executeCommand('xyQt.loadManualProject');
            }
            updateHtml();
            break;
        }
        case 'generateIntelliSense': {
            log(`生成 IntelliSense: C=${msg.cStandard}, C++=${msg.cppStandard}`);
            if (msg.cStandard) { await updateConfig('cStandard', msg.cStandard); }
            if (msg.cppStandard) { await updateConfig('cppStandard', msg.cppStandard); }
            const project = getState().currentProject;
            if (project) {
                log(`项目: ${project.proFile}`);
                generateCppProperties(project);
            } else {
                log('无项目，无法生成 IntelliSense');
                vscode.window.showWarningMessage('请先选择项目');
            }
            break;
        }
    }
}
