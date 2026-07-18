import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ProjectInfo } from '../project/projectManager';
import { getState } from '../../vscode/qtState';
import { getWorkspaceRoot, getCStandard, getCppStandard, getEffectiveQtPath, getScanExcludeDirs } from '../services/configService';
import { log } from '../../vscode/logger';

// 判断目录是否应跳过（精确匹配 + build* 前缀 + 用户自定义）
function shouldSkip(name: string, extraSkip: string[]): boolean {
    const lower = name.toLowerCase();
    if (lower.startsWith('build') || lower === 'debug' || lower === 'release') { return true; }
    if (name === '.git' || name === '.vscode' || name === 'node_modules') { return true; }
    return extraSkip.some(p => name === p || lower === p.toLowerCase());
}

// 扫描目录下所有子目录（递归），返回绝对路径，最多 maxDepth 层
function _scanSubDirsAbs(absDir: string, extraSkip: string[], depth: number = 0): string[] {
    if (depth > 5 || !fs.existsSync(absDir)) { return []; }
    const result: string[] = [absDir.replace(/\\/g, '/')];
    try {
        const entries = fs.readdirSync(absDir, { withFileTypes: true });
        for (const e of entries) {
            if (e.isDirectory() && !e.name.startsWith('.') && !shouldSkip(e.name, extraSkip)) {
                result.push(..._scanSubDirsAbs(path.join(absDir, e.name), extraSkip, depth + 1));
            }
        }
    } catch (e) {
        log(`[configGenerator] 目录扫描失败 (${absDir}): ${e instanceof Error ? e.message : e}`);
    }
    return result;
}

// 获取 include 扫描根目录（.pro 所在目录的父级，覆盖同级依赖库）
function _getScanRoot(project: ProjectInfo): string {
    const proDir = _getProDir(project);
    return proDir ? path.dirname(proDir) : '';
}

// 获取 .pro 所在目录（用于放 .vscode、查找 Makefile 等）
function _getProDir(project: ProjectInfo): string {
    // proPath 始终是绝对路径，最可靠
    if (project.proPath) {
        return path.dirname(project.proPath);
    }
    // fallback: projectDir
    if (path.isAbsolute(project.projectDir)) {
        return project.projectDir;
    }
    const wsRoot = getWorkspaceRoot();
    return wsRoot ? path.join(wsRoot, project.projectDir) : '';
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
    } catch (e) {
        log(`[configGenerator] SDK 版本扫描失败: ${e instanceof Error ? e.message : e}，使用默认值`);
    }
    return '10.0.22000.0';
}

// ── Makefile 解析 ──

function _parseMakefileVar(makefilePath: string, varName: string): string | null {
    try {
        if (!fs.existsSync(makefilePath)) { return null; }
        const content = fs.readFileSync(makefilePath, 'utf-8');
        const match = content.match(new RegExp(`^${varName}[ \\t]+=[ \\t]*(.+)$`, 'm'));
        if (!match) { return null; }
        return match[1].replace(/#.*$/, '').trim();
    } catch (e) {
        log(`[configGenerator] Makefile 读取失败 (${makefilePath}): ${e instanceof Error ? e.message : e}`);
    }
    return null;
}

function _findMakefile(proDir: string): string | null {
    const candidates = [
        path.join(proDir, 'Makefile.Debug'),
        path.join(proDir, 'Makefile.Release'),
        path.join(proDir, 'Makefile')
    ];
    for (const mf of candidates) {
        if (fs.existsSync(mf)) { return mf; }
    }
    return null;
}

// 解析 INCPATH: -I../foo -I"C:/Qt/include" → 绝对路径数组
function _parseIncPath(makefilePath: string, proDir: string): string[] | null {
    const raw = _parseMakefileVar(makefilePath, 'INCPATH');
    if (!raw) { return null; }
    const paths: string[] = [];
    // 匹配 -I"path" 或 -Ipath
    const re = /-I"([^"]+)"|-I(\S+)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        const p = (m[1] || m[2]).replace(/\\/g, '/');
        // 相对路径基于 .pro 所在目录解析
        const abs = path.isAbsolute(p) ? p : path.resolve(proDir, p);
        paths.push(abs.replace(/\\/g, '/'));
    }
    return paths.length > 0 ? paths : null;
}

// 解析 DEFINES: -DFOO -DBAR=1 → ["FOO", "BAR=1"]
function _parseDefines(makefilePath: string): string[] | null {
    const raw = _parseMakefileVar(makefilePath, 'DEFINES');
    if (!raw) { return null; }
    const defs: string[] = [];
    const re = /-D"([^"]+)"|-D(\S+)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        defs.push(m[1] || m[2]);
    }
    return defs.length > 0 ? defs : null;
}

/**
 * 合并写入 c_cpp_properties.json：按 configuration name 更新或追加，保留其他配置
 */
function mergeCppConfiguration(vscodeDir: string, name: string, configuration: Record<string, unknown>): void {
    if (!fs.existsSync(vscodeDir)) { fs.mkdirSync(vscodeDir, { recursive: true }); }
    const outPath = path.join(vscodeDir, 'c_cpp_properties.json');

    let existing: { configurations: Record<string, unknown>[]; version: number } = { configurations: [], version: 4 };
    if (fs.existsSync(outPath)) {
        try {
            existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
        } catch { /* ignore corrupt file */ }
    }

    const idx = existing.configurations.findIndex(c => c.name === name);
    if (idx >= 0) {
        existing.configurations[idx] = configuration;
    } else {
        existing.configurations.push(configuration);
    }

    fs.writeFileSync(outPath, JSON.stringify(existing, null, 4), 'utf-8');
    log(`写入 ${outPath}（configuration: ${name}）`);
}

export function generateCppProperties(project: ProjectInfo): void {
    const scanRoot = _getScanRoot(project);
    const proDir = _getProDir(project);
    log(`生成 IntelliSense: proPath="${project.proPath}", projectDir="${project.projectDir}", proDir="${proDir}", scanRoot="${scanRoot}"`);
    if (!scanRoot || !proDir) {
        log(`生成 IntelliSense 失败: scanRoot="${scanRoot}", proDir="${proDir}"`);
        vscode.window.showWarningMessage('无法确定项目目录，请检查 .pro 文件路径');
        return;
    }

    const isWin = process.platform === 'win32';
    const state = getState();
    const qtPath = getEffectiveQtPath().replace(/\\/g, '/');
    const arch = state.arch;

    const cStandard = getCStandard();
    const cppStandard = getCppStandard();
    const extraSkip = getScanExcludeDirs();

    // 优先从 Makefile 解析 INCPATH 和 DEFINES（不依赖当前 mode，按优先级找）
    const makefile = _findMakefile(proDir);
    const mfIncPath = makefile ? _parseIncPath(makefile, proDir) : null;
    const mfDefines = makefile ? _parseDefines(makefile) : null;

    // include path: Makefile 优先，fallback 到目录扫描
    let includePath: string[];
    if (mfIncPath) {
        includePath = mfIncPath;
    } else {
        const qtModuleIncludes = project.qtModules.map(m => {
            const name = m.charAt(0).toUpperCase() + m.slice(1);
            return `${qtPath}/include/Qt${name}`;
        });
        const projectDirs = _scanSubDirsAbs(scanRoot, extraSkip);
        includePath = [
            ...projectDirs,
            `${qtPath}/include`,
            ...qtModuleIncludes
        ];
    }

    // defines: Makefile 优先，fallback 到推断
    let defines: string[];
    if (mfDefines) {
        defines = mfDefines;
    } else {
        const qtDefines = project.qtModules.map(m => `QT_${m.toUpperCase()}_LIB`);
        const baseDefs = isWin
            ? ['_DEBUG', 'UNICODE', '_UNICODE', 'WIN32', '_WINDOWS', 'QT_DEPRECATED_WARNINGS']
            : ['QT_DEPRECATED_WARNINGS'];
        defines = [...baseDefs, ...project.defines, ...qtDefines];
    }

    // .vscode 目录放在 VSCode workspace root 下（IntelliSense 只认 workspace root）
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || getWorkspaceRoot();
    if (!wsRoot) {
        log('无法确定 workspace root');
        vscode.window.showWarningMessage('无法确定工作区根目录');
        return;
    }
    const vscodeDir = path.join(wsRoot, '.vscode');

    let configuration: Record<string, unknown>;

    if (isWin) {
        const vsInstall = (state.envInfo?.vs?.installPath || '').replace(/\\/g, '/');
        const hostDir = arch === 'x64' ? 'Hostx64' : 'Hostx86';
        const clExe = vsInstall
            ? `${vsInstall}/VC/Tools/MSVC/**/${hostDir}/${arch}/cl.exe`
            : 'cl.exe';
        const intelliSenseMode = arch === 'x64' ? 'windows-msvc-x64' : 'windows-msvc-x86';
        const configName = `Qt ${arch === 'x64' ? 'x64' : 'Win32'}`;
        const sdkVersion = detectSdkVersion();

        configuration = {
            name: configName,
            includePath,
            defines,
            windowsSdkVersion: sdkVersion,
            compilerPath: clExe,
            cStandard,
            cppStandard,
            intelliSenseMode,
            compilerArgs: [],
            browse: {
                path: [scanRoot.replace(/\\/g, '/')],
                limitSymbolsToIncludedHeaders: true
            }
        };
    } else {
        configuration = {
            name: `Qt ${arch === 'x64' ? 'x64' : 'x86'}`,
            includePath,
            defines,
            compilerPath: '/usr/bin/g++',
            cStandard,
            cppStandard,
            intelliSenseMode: 'linux-gcc-x64',
            compilerArgs: [],
            browse: {
                path: [scanRoot.replace(/\\/g, '/')],
                limitSymbolsToIncludedHeaders: true
            }
        };
    }

    // 合并写入：保留已有其他 configuration（如 SDK），按名字更新/追加
    mergeCppConfiguration(vscodeDir, configuration.name as string, configuration);
    const source = mfIncPath ? 'Makefile' : '目录扫描';
    vscode.window.showInformationMessage(`已生成 c_cpp_properties.json（${configuration.name}，来源: ${source}）`);
}

/**
 * 为 SDK 项目生成 c_cpp_properties.json
 * 从 .sln 解析 .vcxproj，从 .vcxproj 提取 AdditionalIncludeDirectories 和 PreprocessorDefinitions
 * @param slnPath .sln 文件的绝对路径
 * @param wsRoot workspace 根目录
 */
export function generateCppPropertiesFromSln(slnPath: string, wsRoot: string): void {
    const slnDir = path.dirname(slnPath);
    const isWin = process.platform === 'win32';
    const state = getState();
    const arch = state.arch || (isWin ? 'x86' : 'x64');

    // 1. 从 .sln 解析所有 .vcxproj 路径
    const vcxprojPaths = parseVcxprojFromSln(slnPath);
    log(`SDK IntelliSense: 从 .sln 解析到 ${vcxprojPaths.length} 个 .vcxproj`);

    // 2. 从所有 .vcxproj 提取 include 路径和 defines
    const includePath: string[] = [];
    const definesSet = new Set<string>();

    for (const vcxproj of vcxprojPaths) {
        const vcxDir = path.dirname(vcxproj);
        const { includes, defines } = parseVcxprojIncludes(vcxproj, arch);
        for (const inc of includes) {
            // 解析相对路径为绝对路径
            const abs = path.resolve(vcxDir, inc).replace(/\\/g, '/');
            if (!includePath.includes(abs)) {
                includePath.push(abs);
            }
        }
        for (const d of defines) {
            // 过滤掉 MSBuild 变量引用
            if (!d.includes('$(') && !d.includes('%(')) {
                definesSet.add(d);
            }
        }
    }

    // 如果解析不到 include 路径，fallback 到 .sln 目录
    if (includePath.length === 0) {
        includePath.push(slnDir.replace(/\\/g, '/'));
        log('SDK IntelliSense: 未从 .vcxproj 解析到 include 路径，fallback 到 .sln 目录');
    }

    const defines = definesSet.size > 0
        ? [...definesSet]
        : ['_DEBUG', 'UNICODE', '_UNICODE', 'WIN32', '_WINDOWS'];

    // VS 编译器路径
    const vsInstall = (state.envInfo?.vs?.installPath || '').replace(/\\/g, '/');
    const hostDir = arch === 'x64' ? 'Hostx64' : 'Hostx86';
    const clExe = vsInstall
        ? `${vsInstall}/VC/Tools/MSVC/**/${hostDir}/${arch}/cl.exe`
        : 'cl.exe';
    const intelliSenseMode = arch === 'x64' ? 'windows-msvc-x64' : 'windows-msvc-x86';
    const configName = `SDK ${arch === 'x64' ? 'x64' : 'Win32'}`;
    const sdkVersion = detectSdkVersion();

    const cStandard = getCStandard();
    const cppStandard = getCppStandard();

    const configuration = {
        name: configName,
        includePath,
        defines,
        windowsSdkVersion: sdkVersion,
        compilerPath: clExe,
        cStandard,
        cppStandard,
        intelliSenseMode,
        compilerArgs: [],
        browse: {
            path: [slnDir.replace(/\\/g, '/')],
            limitSymbolsToIncludedHeaders: true,
        },
    };

    // 写到 VSCode workspace root，合并写入（保留 Qt 等其他 configuration）
    const actualWsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || wsRoot;
    const vscodeDir = path.join(actualWsRoot, '.vscode');
    mergeCppConfiguration(vscodeDir, configuration.name as string, configuration);
    vscode.window.showInformationMessage(`已生成 c_cpp_properties.json（${configName}，来源: ${vcxprojPaths.length} 个 .vcxproj）`);
}

/**
 * 从 .sln 文件解析所有 .vcxproj 路径（绝对路径）
 */
function parseVcxprojFromSln(slnPath: string): string[] {
    const slnDir = path.dirname(slnPath);
    const results: string[] = [];
    try {
        const content = fs.readFileSync(slnPath, 'utf-8');
        // 匹配: Project("{GUID}") = "Name", "path\to\project.vcxproj", "{GUID}"
        const projectRegex = /Project\("\{[^}]+\}"\)\s*=\s*"[^"]*"\s*,\s*"([^"]+\.vcxproj)"/gi;
        let match;
        while ((match = projectRegex.exec(content)) !== null) {
            const relPath = match[1].replace(/\\/g, path.sep);
            const absPath = path.resolve(slnDir, relPath);
            if (fs.existsSync(absPath)) {
                results.push(absPath);
            }
        }
    } catch (e) {
        log(`解析 .sln 失败: ${e instanceof Error ? e.message : e}`);
    }
    return results;
}

/**
 * 从 .vcxproj 提取 AdditionalIncludeDirectories 和 PreprocessorDefinitions
 * 匹配当前架构的 Configuration|Platform 节点
 */
function parseVcxprojIncludes(vcxprojPath: string, arch: string): { includes: string[]; defines: string[] } {
    const includes: string[] = [];
    const defines: string[] = [];
    try {
        const content = fs.readFileSync(vcxprojPath, 'utf-8');
        // 匹配平台: Win32 或 x64
        const platform = arch === 'x64' ? 'x64' : 'Win32';
        // 优先匹配 Release 配置，fallback 到 Debug
        const configs = [`Release|${platform}`, `Debug|${platform}`];

        for (const config of configs) {
            // 匹配 ItemDefinitionGroup 的 Condition
            const conditionRegex = new RegExp(
                `<ItemDefinitionGroup[^>]*Condition="'[^']*\\$\\(Configuration\\)\\|\\$\\(Platform\\)'=='${config.replace('|', '\\|')}'"[^>]*>([\\s\\S]*?)</ItemDefinitionGroup>`,
                'i'
            );
            const groupMatch = conditionRegex.exec(content);
            if (groupMatch) {
                const groupContent = groupMatch[1];

                // 提取 AdditionalIncludeDirectories
                const incMatch = /<AdditionalIncludeDirectories>([^<]+)<\/AdditionalIncludeDirectories>/i.exec(groupContent);
                if (incMatch) {
                    const paths = incMatch[1].split(';').map(p => p.trim()).filter(p => p && !p.startsWith('%('));
                    includes.push(...paths);
                }

                // 提取 PreprocessorDefinitions
                const defMatch = /<PreprocessorDefinitions>([^<]+)<\/PreprocessorDefinitions>/i.exec(groupContent);
                if (defMatch) {
                    const defs = defMatch[1].split(';').map(d => d.trim()).filter(d => d && !d.startsWith('%('));
                    defines.push(...defs);
                }

                break; // 找到匹配的配置就停止
            }
        }
    } catch (e) {
        log(`解析 .vcxproj 失败 (${vcxprojPath}): ${e instanceof Error ? e.message : e}`);
    }
    return { includes, defines };
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
            const configName = process.platform === 'win32' ? `Qt ${getState().arch === 'x64' ? 'x64' : 'Win32'}` : `Qt ${getState().arch}`;
            const config = props.configurations.find((c: Record<string, unknown>) => c.name === configName) || props.configurations[0];
            if (config) {
                config.cStandard = cStandard;
                config.cppStandard = cppStandard;
                fs.writeFileSync(propsPath, JSON.stringify(props, null, 4), 'utf-8');
            }
        }
    } catch (e) {
        log(`[configGenerator] 更新 c_cpp_properties.json 失败: ${e instanceof Error ? e.message : e}`);
    }
}
