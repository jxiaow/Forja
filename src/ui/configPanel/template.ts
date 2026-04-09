import * as fs from 'fs';
import * as path from 'path';
import { EnvInfo, QtInfo } from '../../env/envDetector';
import { ProjectInfo } from '../../project/projectManager';

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
    version: string;
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

export function getHtml(data: TemplateData): string {
    const { env, project, vsDevShellPath, selectedProject, cStandard, cppStandard,
            scanExcludeDirs, qmakeTarget, isWin, autoDevShell, autoQtPath, qtPath } = data;

    const projectName = project ? project.target : (selectedProject || '未选择');
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

    const vars: Record<string, string> = {
        dotVsClass: _dotClass(env, !!env?.vs),
        dotQtClass: _dotClass(env, !!env?.qt),
        dotJomClass: _dotClass(env, jomOk),
        statusSummary,
        textVs,
        textQt,
        textJom,
        refreshDisabled: !env ? 'disabled' : '',
        refreshLabel: !env ? '<span class="spin">↻</span> 检测中...' : '刷新检测',
        projectName,
        selC89: _sel(cStandard, 'c89'),
        selC99: _sel(cStandard, 'c99'),
        selC11: _sel(cStandard, 'c11'),
        selC17: _sel(cStandard, 'c17'),
        'selCpp11': _sel(cppStandard, 'c++11'),
        'selCpp14': _sel(cppStandard, 'c++14'),
        'selCpp17': _sel(cppStandard, 'c++17'),
        'selCpp20': _sel(cppStandard, 'c++20'),
        'selCpp23': _sel(cppStandard, 'c++23'),
        scanExcludeDirs,
        qmakeTarget,
        dotVsBlockClass: effectiveDevShell ? 'dot-ok' : 'dot-warn',
        devShellSource,
        effectiveDevShell: effectiveDevShell || '未配置',
        vsDevShellPath,
        dotQtBlockClass: effectiveQtPath ? 'dot-ok' : 'dot-warn',
        qtSource,
        effectiveQtPath: effectiveQtPath || '未配置',
        qtPathValue: qtPath,
        designerPathValue: data.designerPath,
        qtSourcePathValue: data.qtSourcePath,
        qtCandidateOptions: (env?.qtCandidates ?? [])
            .map((c: QtInfo) => `<option value="${c.path}">Qt ${c.version} (${c.compiler})</option>`)
            .join(''),
        manualProPath: data.manualProPath,
        version: data.version
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
