import * as fs from 'fs';
import * as path from 'path';
import { getEffectiveProjectName } from '../../core/projectDisplay';
import { EnvInfo, QtInfo } from '../../env/envDetector';
import type { ProjectInfo } from '../../project/projectManager';

export interface TemplateData {
    env: EnvInfo | null;
    project: ProjectInfo | null;
    vsDevShellPath: string;
    selectedProject: string;
    cStandard: string;
    cppStandard: string;
    scanExcludeDirs: string;
    qmakeTarget: string;
    isWin: boolean;
    autoDevShell: string;
    autoQtPath: string;
    qtPath: string;
    designerPath: string;
    qtSourcePath: string;
    manualProPath: string;
    fileSyncPromptEnabled: boolean;
    qmakeReminderEnabled: boolean;
    version: string;
    syncEnabled: boolean;
    syncSelectedServer: string;
    syncServers: { name: string; host: string; username: string }[];
    syncRemotePath: string;
    syncIgnore: string;
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
    const { env, project, vsDevShellPath, selectedProject, cStandard, cppStandard,
            scanExcludeDirs, qmakeTarget, isWin, autoDevShell, autoQtPath, qtPath } = data;

    const projectName = getEffectiveProjectName(project, qmakeTarget, selectedProject || '未选择');
    const defaultQmakeTarget = project?.target || '';
    const effectiveQmakeTarget = qmakeTarget || defaultQmakeTarget;
    const effectiveDevShell = vsDevShellPath || autoDevShell;
    const devShellSource = vsDevShellPath ? '手动配置' : (autoDevShell ? '自动检测' : '未配置');
    const effectiveQtPath = qtPath || autoQtPath;
    const qtSource = qtPath ? '手动配置' : (autoQtPath ? '自动检测' : '未配置');

    const jomOk = env?.jom ?? false;
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
        refreshLabel: !env ? '<span class="spin">↻</span>' : '刷新',
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
        scanExcludeDirs: _escapeHtml(scanExcludeDirs),
        effectiveQmakeTarget: _escapeHtml(effectiveQmakeTarget),
        defaultQmakeTarget: _escapeHtml(defaultQmakeTarget),
        savedQmakeTarget: _escapeHtml(qmakeTarget),
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
        qtCandidateOptions: (env?.qtCandidates ?? [])
            .map((c: QtInfo) => `<option value="${_escapeHtml(c.path)}">Qt ${_escapeHtml(c.version)} (${_escapeHtml(c.compiler)})</option>`)
            .join(''),
        manualProPath: _escapeHtml(data.manualProPath),
        chkFileSyncPrompt: data.fileSyncPromptEnabled ? 'checked' : '',
        chkQmakeReminder: data.qmakeReminderEnabled ? 'checked' : '',
        version: _escapeHtml(data.version),
        dotSyncClass: data.syncEnabled && data.syncSelectedServer && data.syncRemotePath ? 'dot-ok' : (data.syncEnabled ? 'dot-warn' : 'dot-detecting'),
        syncStatus: data.syncEnabled ? (data.syncSelectedServer ? '已启用' : '未配置') : '未启用',
        chkSyncEnabled: data.syncEnabled ? 'checked' : '',
        syncConfigDisplay: data.syncEnabled ? '' : 'display:none',
        syncServerOptions: data.syncServers
            .map(s => `<option value="${_escapeHtml(s.name)}" ${s.name === data.syncSelectedServer ? 'selected' : ''}>${_escapeHtml(s.name)} (${_escapeHtml(s.username)}@${_escapeHtml(s.host)})</option>`)
            .join(''),
        syncRemotePath: _escapeHtml(data.syncRemotePath),
        syncIgnore: _escapeHtml(data.syncIgnore)
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
