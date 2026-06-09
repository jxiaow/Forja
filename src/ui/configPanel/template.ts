import * as fs from 'fs';
import * as path from 'path';
import { getEffectiveProjectName } from '../../qt/project/projectDisplay';
import { EnvInfo, QtInfo, VSInfo } from '../../qt/env/envDetector';
import type { ProjectInfo } from '../../qt/project/projectManager';
import { jsLiteral } from './jsLiteral';

export interface TemplateData {
    env: EnvInfo | null;
    project: ProjectInfo | null;
    vsDevShellPath: string;
    pinnedProject: string;
    mode: string;
    arch: string;
    cStandard: string;
    cppStandard: string;
    scanExcludeDirs: string;
    target: string;
    qmakeArgs?: string;
    runtimeProcessName: string;
    isWin: boolean;
    autoDevShell: string;
    autoQtPath: string;
    qtPath: string;
    designerPath: string;
    qtSourcePath: string;
    manualProPath: string;
    fileSyncPromptEnabled: boolean;
    qmakeReminderEnabled: boolean;
    rccProjectPath: string;
    version: string;
    syncEnabled: boolean;
    syncSelectedServer: string;
    syncServers: { id: string; name: string; host: string; port: number; username: string; authMode: string; privateKeyPath: string; password: string }[];
    syncIgnore: string;
    syncRemotePath: string;
    syncPendingCount: number;
    syncLastTime: string;
    syncReadinessIssues?: string[];
    // SDK
    sdkProjectName: string;
    sdkMode: string;
    sdkArch: string;
    sdkVsInstall: string;
    // 模块激活状态
    qtActive: boolean;
    sdkActive: boolean;
}

let _templateCache: string | null = null;

function _loadTemplate(): string {
    if (!_templateCache) {
        const htmlPath = path.join(__dirname, 'configPanel.html');
        _templateCache = fs.readFileSync(htmlPath, 'utf-8');
    }
    return _templateCache;
}

function _dotClass(detected: unknown, ok: boolean): string {
    if (detected === null || detected === undefined) { return 'dot-detecting'; }
    return ok ? 'dot-ok' : 'dot-warn';
}

function _sel(current: string, value: string): string {
    return current === value ? 'selected' : '';
}

function _escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function getHtml(data: TemplateData): string {
    const { env, project, vsDevShellPath, pinnedProject, cStandard, cppStandard,
            scanExcludeDirs, target, runtimeProcessName, isWin, autoDevShell, autoQtPath, qtPath } = data;

    const projectName = getEffectiveProjectName(project, target, pinnedProject || '未选择');
    const defaultTarget = project?.target || '';
    const effectiveTarget = target || defaultTarget;
    const effectiveDevShell = vsDevShellPath || autoDevShell;
    const devShellSource = vsDevShellPath ? '手动配置' : (autoDevShell ? '自动检测' : '未配置');
    const effectiveQtPath = qtPath || autoQtPath;
    const qtSource = qtPath ? '手动配置' : (autoQtPath ? '自动检测' : '未配置');

    const jomOk = !!env?.jom;
    const makeLabel = isWin ? 'jom' : 'make';

    // 状态摘要
    let statusSummary: string;
    if (!env) {
        statusSummary = '检测中...';
    } else {
        const vsPart = isWin ? (env.vs ? 'VS ' + env.vs.version : 'VS 未检测') + ' · ' : '';
        statusSummary = vsPart + (env.qt ? 'Qt ' + env.qt.version : 'Qt 未检测') + ' · ' + (jomOk ? makeLabel + ' 可用' : makeLabel + ' 未找到');
    }

    // 详情文本
    const textVs = env ? (env.vs ? 'VS ' + env.vs.version + ' ' + env.vs.edition : '未检测到 Visual Studio') : '检测中...';
    const textQt = env ? (env.qt ? 'Qt ' + env.qt.version + ' (' + env.qt.compiler + ')' : '未检测到 Qt') : '检测中...';
    const textJom = env ? (jomOk ? makeLabel + ' 可用' : makeLabel + ' 未找到') : '检测中...';

    // Chip 文本（紧凑版）
    const textVsChip = env ? (env.vs ? 'VS ' + env.vs.version : 'VS 未检测') : '检测中...';
    const textQtChip = env ? (env.qt ? 'Qt ' + env.qt.version : 'Qt 未检测') : '检测中...';
    const textJomChip = env ? (jomOk ? makeLabel : makeLabel + ' ✗') : '检测中...';

    const vars: Record<string, string> = {
        dotVsClass: _dotClass(env, !!env?.vs),
        dotQtClass: _dotClass(env, !!env?.qt),
        dotJomClass: _dotClass(env, jomOk),
        statusSummary: _escapeHtml(statusSummary),
        textVs: _escapeHtml(textVs),
        textQt: _escapeHtml(textQt),
        textJom: _escapeHtml(textJom),
        textVsChip: _escapeHtml(textVsChip),
        textQtChip: _escapeHtml(textQtChip),
        textJomChip: _escapeHtml(textJomChip),
        refreshDisabled: !env ? 'disabled' : '',
        refreshLabel: !env ? '<span class="spin">↻</span> 检测中...' : '刷新环境检测',
        projectName: _escapeHtml(projectName),
        selC89: _sel(cStandard, 'c89'),
        selC99: _sel(cStandard, 'c99'),
        selC11: _sel(cStandard, 'c11'),
        selC17: _sel(cStandard, 'c17'),
        'selCpp11': _sel(cppStandard, 'c++11'),
        'selCpp14': _sel(cppStandard, 'c++14'),
        'selCpp17': _sel(cppStandard, 'c++17'),
        'selCpp20': _sel(cppStandard, 'c++20'),
        'selCpp23': _sel(cppStandard, 'c++23'),
        scanExcludeDirs: jsLiteral(scanExcludeDirs),
        effectiveTarget: _escapeHtml(effectiveTarget),
        defaultTarget: _escapeHtml(defaultTarget),
        savedTarget: _escapeHtml(target),
        qmakeArgs: _escapeHtml(data.qmakeArgs || ''),
        runtimeProcessName: _escapeHtml(runtimeProcessName),
        dotVsBlockClass: effectiveDevShell ? 'dot-ok' : 'dot-warn',
        vsBadgeClass: effectiveDevShell ? 'badge-ok' : 'badge-warn',
        devShellSource: _escapeHtml(devShellSource),
        effectiveDevShell: _escapeHtml(effectiveDevShell || '未配置'),
        vsDevShellPath: _escapeHtml(vsDevShellPath),
        dotQtBlockClass: effectiveQtPath ? 'dot-ok' : 'dot-warn',
        qtBadgeClass: effectiveQtPath ? 'badge-ok' : 'badge-warn',
        qtSource: _escapeHtml(qtSource),
        effectiveQtPath: _escapeHtml(effectiveQtPath || '未配置'),
        qtPathValue: _escapeHtml(qtPath),
        designerPathValue: _escapeHtml(data.designerPath),
        qtSourcePathValue: _escapeHtml(data.qtSourcePath),
        jomBadgeClass: jomOk ? 'badge-ok' : 'badge-warn',
        jomSource: jomOk ? '自动检测' : '未找到',
        effectiveJomPath: _escapeHtml(env?.jom || '未检测到'),
        buildToolLabel: makeLabel,
        qtCandidateOptions: (env?.qtCandidates ?? [])
            .map((c: QtInfo) => `<option value="${_escapeHtml(c.path)}">Qt ${_escapeHtml(c.version)} (${_escapeHtml(c.compiler)})</option>`)
            .join(''),
        vsCandidateOptions: (env?.vsCandidates ?? [])
            .map((c: VSInfo) => `<option value="${_escapeHtml(c.devShellPath)}">VS ${_escapeHtml(c.version)} ${_escapeHtml(c.edition)}</option>`)
            .join(''),
        manualProPath: _escapeHtml(data.manualProPath),
        rccProjectPath: _escapeHtml(data.rccProjectPath),
        chkFileSyncPrompt: data.fileSyncPromptEnabled ? 'checked' : '',
        chkQmakeReminder: data.qmakeReminderEnabled ? 'checked' : '',
        version: _escapeHtml(data.version),
        syncServerOptions: data.syncServers.length > 0
            ? data.syncServers
                .map(s => `<option value="${_escapeHtml(s.id)}" ${s.id === data.syncSelectedServer ? 'selected' : ''}>${_escapeHtml(s.name)} (${_escapeHtml(s.username)}@${_escapeHtml(s.host)})</option>`)
                .join('')
            : '<option value="">— 无服务器 —</option>',
        syncServerData: jsLiteral(JSON.stringify(data.syncServers)),
        syncIgnore: jsLiteral(data.syncIgnore),
        syncEnabledChecked: data.syncEnabled ? 'checked' : '',
        syncRemotePath: _escapeHtml(data.syncRemotePath),
        syncPendingCount: String(data.syncPendingCount),
        syncLastTime: _escapeHtml(data.syncLastTime),
        syncHasServer: data.syncServers.length > 0 ? 'true' : '',
    };

    let html = _loadTemplate();

    // 条件区块：<!--IF_WIN-->...<!--END_WIN-->
    if (!isWin) {
        html = html.replace(/<!--IF_WIN-->[\s\S]*?<!--END_WIN-->/g, '');
    } else {
        html = html.replace(/<!--IF_WIN-->/g, '').replace(/<!--END_WIN-->/g, '');
    }

    // 变量替换：{{key}}
    html = html.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
        return vars[key] ?? '';
    });

    return html;
}
