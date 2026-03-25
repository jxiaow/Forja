import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectInfo } from '../project/projectManager';
import { getState } from '../core/stateManager';
import { getWorkspaceRoot, getCStandard, getCppStandard, getScanExcludeDirs } from '../core/configService';

// 判断目录是否应跳过（精确匹配 + build* 前缀 + 用户自定义）
function shouldSkip(name: string, extraSkip: string[]): boolean {
    const lower = name.toLowerCase();
    if (lower.startsWith('build') || lower === 'debug' || lower === 'release') { return true; }
    if (name === '.git' || name === '.vscode' || name === 'node_modules') { return true; }
    return extraSkip.some(p => name === p || lower === p.toLowerCase());
}

// 扫描目录下所有子目录（递归），返回 ${workspaceFolder}/... 格式路径
function scanSubDirs(root: string, relDir: string, extraSkip: string[]): string[] {
    const absDir = path.join(root, relDir);
    if (!fs.existsSync(absDir)) { return []; }
    const result: string[] = [`\${workspaceFolder}/${relDir}`];
    try {
        const entries = fs.readdirSync(absDir, { withFileTypes: true });
        for (const e of entries) {
            if (e.isDirectory() && !e.name.startsWith('.') && !shouldSkip(e.name, extraSkip)) {
                result.push(...scanSubDirs(root, `${relDir}/${e.name}`, extraSkip));
            }
        }
    } catch {}
    return result;
}

// 检测已安装的 Windows SDK 最新版本
function detectSdkVersion(): string {
    const sdkRoot = 'C:\\Program Files (x86)\\Windows Kits\\10\\Include';
    try {
        if (fs.existsSync(sdkRoot)) {
            const versions = fs.readdirSync(sdkRoot)
                .filter(v => /^\d+\.\d+\.\d+\.\d+$/.test(v))
                .sort()
                .reverse();
            if (versions.length > 0) { return versions[0]; }
        }
    } catch {}
    return '10.0.22000.0';
}

export function generateCppProperties(project: ProjectInfo): void {
    const root = getWorkspaceRoot();
    if (!root) { return; }

    const state = getState();
    const qtPath = (state.envInfo?.qt?.path || '').replace(/\\/g, '/');
    const arch = state.arch;

    // 从 VS installPath 推断 cl.exe 路径（用 glob，让 IntelliSense 自动匹配 MSVC 版本）
    const vsInstall = (state.envInfo?.vs?.installPath || '').replace(/\\/g, '/');
    const hostDir = arch === 'x64' ? 'Hostx64' : 'Hostx86';
    const clExe = vsInstall
        ? `${vsInstall}/VC/Tools/MSVC/**/${hostDir}/${arch}/cl.exe`
        : 'cl.exe';

    // intelliSenseMode 根据架构
    const intelliSenseMode = arch === 'x64' ? 'windows-msvc-x64' : 'windows-msvc-x86';
    // configuration name 根据架构
    const configName = arch === 'x64' ? 'x64' : 'Win32';

    // Windows SDK 版本
    const sdkVersion = detectSdkVersion();

    const cStandard = getCStandard();
    const cppStandard = getCppStandard();
    const extraSkip = getScanExcludeDirs();

    // Qt 模块 include 路径
    const qtModuleIncludes = project.qtModules.map(m => {
        const name = m.charAt(0).toUpperCase() + m.slice(1);
        return `${qtPath}/include/Qt${name}`;
    });

    // 扫描 workspace 根目录下所有顶层目录
    const allSubDirs: string[] = [];
    try {
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const e of entries) {
            if (e.isDirectory() && !e.name.startsWith('.') && !shouldSkip(e.name, extraSkip)) {
                allSubDirs.push(...scanSubDirs(root, e.name, extraSkip));
            }
        }
    } catch {}

    // 确保当前项目目录在其中（去重）
    const projectSubDirs = scanSubDirs(root, project.projectDir, extraSkip);
    const includeDirs = [...new Set([...projectSubDirs, ...allSubDirs])];

    // Qt 模块 define
    const qtDefines = project.qtModules.map(m => `QT_${m.toUpperCase()}_LIB`);

    const config = {
        configurations: [{
            name: configName,
            includePath: [
                '${workspaceFolder}/**',
                ...includeDirs,
                `${qtPath}/include`,
                ...qtModuleIncludes
            ],
            defines: [
                '_DEBUG', 'UNICODE', '_UNICODE', 'WIN32', '_WINDOWS',
                'QT_DEPRECATED_WARNINGS',
                ...project.defines,
                ...qtDefines
            ],
            windowsSdkVersion: sdkVersion,
            compilerPath: clExe,
            cStandard: cStandard,
            cppStandard: cppStandard,
            intelliSenseMode,
            compilerArgs: [],
            browse: {
                path: ['${workspaceFolder}'],
                limitSymbolsToIncludedHeaders: true
            }
        }],
        version: 4
    };

    const vscodeDir = path.join(root, '.vscode');
    if (!fs.existsSync(vscodeDir)) { fs.mkdirSync(vscodeDir, { recursive: true }); }

    fs.writeFileSync(path.join(vscodeDir, 'c_cpp_properties.json'), JSON.stringify(config, null, 4), 'utf-8');
    vscode.window.showInformationMessage('已生成 c_cpp_properties.json');
}

export function updateCppPropertiesStandard(cStandard: string, cppStandard: string): void {
    const root = getWorkspaceRoot();
    if (!root) { return; }

    const vscodeDir = path.join(root, '.vscode');
    const propsPath = path.join(vscodeDir, 'c_cpp_properties.json');

    if (!fs.existsSync(propsPath)) {
        const project = getState().currentProject;
        if (project) {
            generateCppProperties(project);
        }
        return;
    }

    try {
        const content = fs.readFileSync(propsPath, 'utf-8');
        const props = JSON.parse(content);

        if (props.configurations && props.configurations.length > 0) {
            props.configurations[0].cStandard = cStandard;
            props.configurations[0].cppStandard = cppStandard;
            fs.writeFileSync(propsPath, JSON.stringify(props, null, 4), 'utf-8');
        }
    } catch (e) {
        console.error('[XY Qt] 更新 c_cpp_properties.json 失败:', e);
    }
}
