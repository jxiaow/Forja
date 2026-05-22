/**
 * SDK CLI entry point — called by the unified compilot dispatcher.
 * Provides init/env/projects/status/build/rebuild/clean operations for .sln and Makefile projects.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as cp from 'child_process';
import { EXCLUDE_DIRS, EXCLUDE_PATH_SEGMENTS, DEFAULT_SCAN_DEPTH } from '../constants';
import { getSdkDefaultArch, getSdkAvailableArch } from './requirements';
import { loadSdkSettings, saveSdkSettings, sdkSettingsFilePath } from './settings';
import { detectVsInstallations, detectMake } from './envDetector';

interface SdkCliOptions {
    action: string;
    workspace: string;
    project: string | null;
    mode: 'debug' | 'release' | null;
    arch: 'x86' | 'x64' | null;
    vsDevCmd: string | null;
    execute: boolean;
    json: boolean;
}

interface EffectiveSdkCliOptions extends Omit<SdkCliOptions, 'mode' | 'arch'> {
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
}

interface SdkDiagnostic {
    level: 'info' | 'warning' | 'error';
    message: string;
}

function parseArgs(argv: string[]): SdkCliOptions {
    const VALID_ACTIONS = ['init', 'env', 'projects', 'status', 'build', 'rebuild', 'clean'];

    const options: SdkCliOptions = {
        action: argv[0] || 'status',
        workspace: process.cwd(),
        project: null,
        mode: null,
        arch: null,
        vsDevCmd: null,
        execute: true,
        json: false
    };

    for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--workspace': {
                const val = argv[i + 1];
                if (!val || val.startsWith('--')) { throw new Error('--workspace 需要一个值'); }
                options.workspace = argv[++i];
                break;
            }
            case '--project': {
                const val = argv[i + 1];
                if (!val || val.startsWith('--')) { throw new Error('--project 需要一个值'); }
                options.project = argv[++i];
                break;
            }
            case '--mode': {
                const val = argv[i + 1];
                if (!val || val.startsWith('--')) { throw new Error('--mode 需要一个值'); }
                const modeVal = argv[++i];
                if (modeVal !== 'debug' && modeVal !== 'release') { throw new Error(`无效的 --mode 值: ${modeVal}`); }
                options.mode = modeVal;
                break;
            }
            case '--arch': {
                const val = argv[i + 1];
                if (!val || val.startsWith('--')) { throw new Error('--arch 需要一个值'); }
                const archVal = argv[++i];
                if (archVal !== 'x86' && archVal !== 'x64') { throw new Error(`无效的 --arch 值: ${archVal}`); }
                if (!getSdkAvailableArch().includes(archVal)) { throw new Error(`当前平台不支持 --arch 值: ${archVal}`); }
                options.arch = archVal;
                break;
            }
            case '--vs-dev-cmd': {
                const val = argv[i + 1];
                if (!val || val.startsWith('--')) { throw new Error('--vs-dev-cmd 需要一个值'); }
                options.vsDevCmd = argv[++i];
                break;
            }
            case '--plan':
            case '--dry-run':
                options.execute = false;
                break;
            case '--json':
                options.json = true;
                break;
            default:
                if (arg.startsWith('--')) {
                    throw new Error(`未知参数: ${arg}`);
                }
                throw new Error(`未知参数: ${arg}`);
        }
    }

    if (!VALID_ACTIONS.includes(options.action)) {
        throw new Error(`未知动作: ${options.action}。可用: ${VALID_ACTIONS.join(', ')}`);
    }

    options.workspace = path.resolve(options.workspace);
    if (!fs.existsSync(options.workspace)) {
        throw new Error(`工作区目录不存在: ${options.workspace}`);
    }
    return options;
}

function resolveProjectPath(workspace: string, project: string): string {
    return path.isAbsolute(project) ? path.resolve(project) : path.resolve(workspace, project);
}

export function scanProjects(workspace: string, depth: number = DEFAULT_SCAN_DEPTH): string[] {
    const results: string[] = [];
    const isWindows = os.platform() === 'win32';
    const pattern = isWindows ? /\.sln$/i : /^(Makefile|makefile|GNUmakefile)$/;

    function walk(dir: string, currentDepth: number): void {
        if (currentDepth > depth) { return; }
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (EXCLUDE_DIRS.includes(entry.name)) { continue; }
                const subDir = path.join(dir, entry.name);
                const relativePath = path.relative(workspace, subDir).replace(/\\/g, '/');
                if (EXCLUDE_PATH_SEGMENTS.some(seg => relativePath.includes(seg))) { continue; }
                walk(subDir, currentDepth + 1);
            } else if (entry.isFile() && pattern.test(entry.name)) {
                results.push(path.join(dir, entry.name));
            }
        }
    }

    walk(workspace, 0);
    return results;
}

function buildCommand(options: EffectiveSdkCliOptions, projectPath: string, vsDevCmdPath: string): string[] {
    const isWindows = os.platform() === 'win32';
    const commands: string[] = [];

    if (isWindows && projectPath.endsWith('.sln')) {
        // 初始化 VS 环境
        if (vsDevCmdPath) {
            commands.push(`call "${vsDevCmdPath}" -arch=${options.arch} -no_logo`);
        }
        const msbuildAction = options.action === 'clean' ? 'Clean'
            : options.action === 'rebuild' ? 'Rebuild'
            : 'Build';
        const config = options.mode === 'release' ? 'Release' : 'Debug';
        const platform = options.arch === 'x64' ? 'x64' : 'Win32';
        commands.push(`msbuild "${projectPath}" /t:${msbuildAction} /p:Configuration=${config} /p:Platform=${platform} /m`);
    } else {
        const makefileDir = path.dirname(projectPath);
        const target = options.action === 'clean' ? 'clean'
            : options.action === 'rebuild' ? 'clean all'
            : '';
        commands.push(`make -C "${makefileDir}" ${target} -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)`.trim());
    }
    return commands;
}

function executeAsync(commandLine: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise(resolve => {
        cp.exec(commandLine, { cwd, windowsHide: true, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
            let exitCode = 0;
            if (error) {
                const execError = error as cp.ExecException;
                if (typeof execError.code === 'number') { exitCode = execError.code; }
                else if (execError.signal) { exitCode = 128; }
                else { exitCode = 1; }
            }
            resolve({ exitCode, stdout: stdout || '', stderr: stderr || '' });
        });
    });
}

function extractErrors(output: string): string[] {
    const errorPattern = /\): error |: error:|: fatal error |: fatal error:/i;
    return output.split(/\r?\n/).filter(l => errorPattern.test(l)).slice(0, 20);
}

function getHelpText(): string {
    return `
Compilot SDK CLI

用法:
  compilot sdk <action> [options]

动作:
  init      初始化本地配置（检测 VS 环境、保存用户项目配置）
  env       查看构建环境（VS 版本、make 等）
  projects  查看 workspace 下的项目文件
  status    显示项目就绪状态
  build     编译项目
  rebuild   重新编译（clean + build）
  clean     清理编译产物

选项:
  --workspace <path>     工作区路径（默认当前目录）
  --project <path>       项目入口文件路径（.sln 或 Makefile）
  --mode <mode>          编译模式: debug | release（默认 debug）
  --arch <arch>          目标架构: ${getSdkAvailableArch().join(' | ')}（默认 ${getSdkDefaultArch()}）
  --vs-dev-cmd <path>    VsDevCmd.bat 路径（Windows）
  --plan                 仅输出命令计划，不执行
  --json                 JSON 格式输出

示例:
  compilot sdk status --json
  compilot sdk init --json
  compilot sdk env --json
  compilot sdk build --mode release --arch x64 --json
  compilot sdk build --plan --json
`.trim();
}

export async function runSdkCli(argv: string[]): Promise<void> {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        console.log(getHelpText());
        return;
    }

    const wantsJson = argv.includes('--json');

    try {
        const options = parseArgs(argv);

        const settings = loadSdkSettings(options.workspace);
        const effectiveMode = options.mode || settings.mode || 'debug';
        const settingsArch = getSdkAvailableArch().includes(settings.arch) ? settings.arch : getSdkDefaultArch();
        const effectiveArch = options.arch || settingsArch;
        const effectiveOptions: EffectiveSdkCliOptions = {
            ...options,
            mode: effectiveMode,
            arch: effectiveArch
        };

        // ── init ──
        if (options.action === 'init') {
            const vsInstallations = detectVsInstallations();
            const _makePath = detectMake();

            const mode = effectiveMode;
            const arch = effectiveArch;
            const vsDevCmd = options.vsDevCmd || (vsInstallations.length > 0 ? vsInstallations[0].vsDevCmdPath : '');
            const project = options.project ? path.relative(options.workspace, resolveProjectPath(options.workspace, options.project)) : settings.pinnedProject;

            const newSettings = { mode, arch, vsDevCmdPath: vsDevCmd, pinnedProject: project };
            saveSdkSettings(options.workspace, newSettings);

            const diagnostics: SdkDiagnostic[] = [];
            const autoSelected: string[] = [];
            if (!options.vsDevCmd && vsInstallations.length > 1) { autoSelected.push('vsDevCmd'); }
            if (autoSelected.length > 0) {
                diagnostics.push({ level: 'warning', message: `部分配置为自动选择（${autoSelected.join(', ')}），可用 compilot sdk env --json 查看可选项` });
            }
            if (!project) {
                const candidates = scanProjects(options.workspace, settings.scanDepth || DEFAULT_SCAN_DEPTH);
                if (candidates.length > 1) {
                    diagnostics.push({ level: 'warning', message: `发现 ${candidates.length} 个项目文件，未自动选择，可用 compilot sdk projects --json 查看全部` });
                } else if (candidates.length === 0) {
                    diagnostics.push({ level: 'warning', message: '未检测到项目文件' });
                }
            }

            const out: Record<string, unknown> = {
                ok: true,
                action: 'init',
                resolved: { mode, arch, vsDevCmdPath: vsDevCmd || undefined, project: project || undefined }
            };
            if (diagnostics.length > 0) { out.diagnostics = diagnostics; }

            if (wantsJson) { console.log(JSON.stringify(out, null, 2)); }
            else { console.log(`SDK 配置已保存: mode=${mode}, arch=${arch}`); }
            return;
        }

        // ── env ──
        if (options.action === 'env') {
            const vsInstallations = detectVsInstallations();
            const makePath = detectMake();
            const currentVsDevCmd = settings.vsDevCmdPath || (vsInstallations.length > 0 ? vsInstallations[0].vsDevCmdPath : '');

            const out: Record<string, unknown> = {
                ok: true,
                action: 'env',
                current: {
                    mode: effectiveMode,
                    arch: effectiveArch,
                    vsDevCmd: currentVsDevCmd || null,
                    make: makePath || null
                },
                available: {
                    mode: ['debug', 'release'],
                    arch: getSdkAvailableArch(),
                    ...(process.platform === 'win32' ? {
                        vs: vsInstallations.map(v => ({ path: v.vsDevCmdPath, version: v.version, edition: v.edition }))
                    } : {}),
                    ...(process.platform !== 'win32' ? { make: makePath ? [makePath] : [] } : {})
                },
                configHints: {
                    usage: 'compilot sdk init [options] --json',
                    mode: '--mode debug|release',
                    ...(getSdkAvailableArch().length > 1 ? { arch: `--arch ${getSdkAvailableArch().join('|')}` } : {}),
                    ...(process.platform === 'win32' ? { vsDevCmd: '--vs-dev-cmd <path>' } : {})
                }
            };

            if (wantsJson) { console.log(JSON.stringify(out, null, 2)); }
            else {
                console.log('SDK 构建环境:');
                console.log(`  mode: ${effectiveMode}`);
                console.log(`  arch: ${effectiveArch}`);
                if (process.platform === 'win32') {
                    console.log(`  VS: ${currentVsDevCmd || '未检测到'}`);
                    if (vsInstallations.length > 1) {
                        console.log(`  可用 VS (${vsInstallations.length}):`);
                        vsInstallations.forEach(v => console.log(`    ${v.vsDevCmdPath} (${v.version} ${v.edition})`));
                    }
                } else {
                    console.log(`  make: ${makePath || '未检测到'}`);
                }
            }
            return;
        }

        // ── projects ──
        if (options.action === 'projects') {
            const candidates = scanProjects(options.workspace, settings.scanDepth || DEFAULT_SCAN_DEPTH);
            const currentProject = settings.pinnedProject;
            const available = candidates.map(c => ({
                path: path.relative(options.workspace, c) || c,
                type: c.endsWith('.sln') ? 'sln' : 'makefile'
            }));

            const out: Record<string, unknown> = {
                ok: true,
                action: 'projects',
                current: currentProject,
                available,
                configHints: { usage: 'compilot sdk init --project <path> --json' }
            };
            if (currentProject && !fs.existsSync(path.join(options.workspace, currentProject))) {
                out.currentExists = false;
            }

            if (wantsJson) { console.log(JSON.stringify(out, null, 2)); }
            else {
                console.log('SDK 项目列表:');
                if (available.length === 0) { console.log('  未检测到项目文件'); }
                else { available.forEach(p => console.log(`  ${p.path} (${p.type})${p.path === currentProject ? ' ← 当前' : ''}`)); }
            }
            return;
        }

        // ── 解析项目 ──
        const candidates = scanProjects(options.workspace, settings.scanDepth || DEFAULT_SCAN_DEPTH);

        // ── status ──
        if (options.action === 'status') {
            let statusProjectPath = options.project ? resolveProjectPath(options.workspace, options.project) : null;
            if (!statusProjectPath && settings.pinnedProject) {
                const pinned = path.join(options.workspace, settings.pinnedProject);
                if (fs.existsSync(pinned)) { statusProjectPath = pinned; }
            }
            if (!statusProjectPath && candidates.length === 1) {
                statusProjectPath = candidates[0];
            }

            const hasSettings = fs.existsSync(sdkSettingsFilePath(options.workspace));
            const projectExists = !!statusProjectPath && fs.existsSync(statusProjectPath);
            const projectRel = statusProjectPath ? path.relative(options.workspace, statusProjectPath) || statusProjectPath : null;
            const checks: Record<string, boolean> = { settings: hasSettings, project: projectExists };
            const missing: string[] = [];

            if (!hasSettings) { missing.push('settings'); }
            if (!projectExists) { missing.push('project'); }

            if (process.platform === 'win32') {
                const vsDevCmdPath = options.vsDevCmd || settings.vsDevCmdPath || '';
                const hasVsDevCmd = !!vsDevCmdPath && fs.existsSync(vsDevCmdPath);
                checks.vsDevCmd = hasVsDevCmd;
                if (!hasVsDevCmd) { missing.push('vsDevCmd'); }
            } else {
                const hasMake = !!detectMake();
                checks.make = hasMake;
                if (!hasMake) { missing.push('make'); }
            }

            const ready = Object.values(checks).every(v => v);
            let nextAction: string;
            if (!hasSettings || missing.includes('vsDevCmd') || missing.includes('make')) { nextAction = 'init'; }
            else if (!projectExists && candidates.length > 1) { nextAction = 'projects'; }
            else if (!projectExists) { nextAction = 'init'; }
            else { nextAction = 'build'; }

            const diagnostics: SdkDiagnostic[] = [];
            if (!hasSettings) { diagnostics.push({ level: 'warning', message: '尚未初始化' }); }
            if (!projectExists) {
                if (candidates.length > 1) {
                    diagnostics.push({ level: 'warning', message: `发现 ${candidates.length} 个项目文件，请使用 --project 指定` });
                } else if (candidates.length === 0) {
                    diagnostics.push({ level: 'warning', message: '未找到项目文件' });
                } else if (hasSettings) {
                    diagnostics.push({ level: 'warning', message: '项目文件不存在' });
                }
            }

            const out: Record<string, unknown> = {
                ok: true,
                action: 'status',
                workspace: options.workspace,
                ready,
                checks,
                nextAction,
                project: projectRel,
                candidates: candidates.map(c => path.relative(options.workspace, c) || c),
                resolved: { mode: effectiveMode, arch: effectiveArch }
            };
            if (missing.length > 0) { out.missing = missing; }
            if (diagnostics.length > 0) { out.diagnostics = diagnostics; }

            if (wantsJson) { console.log(JSON.stringify(out, null, 2)); }
            else {
                console.log(`SDK 项目状态: ${ready ? '就绪' : '未就绪'}`);
                console.log(`  项目: ${projectRel || '未选择'}`);
                console.log(`  模式: ${effectiveMode}/${effectiveArch}`);
                console.log('');
                console.log('检查项:');
                for (const [key, ok] of Object.entries(checks)) { console.log(`  ${ok ? '✓' : '✗'} ${key}`); }
                if (diagnostics.length > 0) {
                    console.log('');
                    diagnostics.forEach(d => console.log(`${d.level}: ${d.message}`));
                }
                console.log('');
                console.log(`下一步: compilot sdk ${nextAction}`);
            }
            return;
        }

        let projectPath = options.project ? resolveProjectPath(options.workspace, options.project) : null;
        if (!projectPath && settings.pinnedProject) {
            const pinned = path.join(options.workspace, settings.pinnedProject);
            if (fs.existsSync(pinned)) { projectPath = pinned; }
        }
        if (!projectPath) {
            if (candidates.length === 1) { projectPath = candidates[0]; }
            else if (candidates.length === 0) {
                const out = { ok: false, action: options.action, diagnostics: [{ level: 'error', message: '未找到项目文件' }], nextActions: ['compilot sdk status --json'] };
                if (wantsJson) { console.log(JSON.stringify(out, null, 2)); }
                else { console.error('未找到 .sln 或 Makefile 项目文件'); }
                process.exitCode = 1;
                return;
            } else {
                const out = { ok: false, action: options.action, diagnostics: [{ level: 'error', message: `发现 ${candidates.length} 个项目文件，请使用 --project 指定` }], nextActions: ['compilot sdk status --json'] };
                if (wantsJson) { console.log(JSON.stringify(out, null, 2)); }
                else { console.error(`发现 ${candidates.length} 个项目文件，请使用 --project 指定`); }
                process.exitCode = 1;
                return;
            }
        }

        const projectRel = path.relative(options.workspace, projectPath) || projectPath;
        const vsDevCmdPath = options.vsDevCmd || settings.vsDevCmdPath || '';

        // ── build/rebuild/clean ──
        const commands = buildCommand(effectiveOptions, projectPath, vsDevCmdPath);
        const shellCommand = commands.join(' && ');

        if (!options.execute) {
            const out = { ok: true, action: options.action, project: projectRel, commands, shellCommand, resolved: { mode: effectiveMode, arch: effectiveArch } };
            if (wantsJson) { console.log(JSON.stringify(out, null, 2)); }
            else {
                console.log(`SDK ${options.action} 命令:`);
                commands.forEach(c => console.log(`  ${c}`));
            }
            return;
        }

        const started = Date.now();
        const executed = await executeAsync(shellCommand, options.workspace);
        const durationMs = Date.now() - started;
        const errors = executed.exitCode !== 0 ? extractErrors(executed.stdout + '\n' + executed.stderr) : [];

        const out: Record<string, unknown> = {
            ok: executed.exitCode === 0,
            action: options.action,
            project: projectRel,
            exitCode: executed.exitCode,
            durationMs,
            resolved: { mode: effectiveMode, arch: effectiveArch }
        };
        if (errors.length > 0) { out.errors = errors; }
        if (!out.ok) {
            out.diagnostics = [{ level: 'error', message: '命令执行失败' }];
            out.nextActions = ['compilot sdk status --json'];
        }

        if (wantsJson) { console.log(JSON.stringify(out, null, 2)); }
        else {
            if (out.ok) { console.log(`SDK ${options.action} 成功 (${durationMs}ms)`); }
            else {
                console.error(`SDK ${options.action} 失败 (退出码: ${executed.exitCode})`);
                if (errors.length > 0) { errors.forEach(e => console.error(`  ${e}`)); }
            }
        }
        process.exitCode = (out.ok as boolean) ? 0 : 1;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (wantsJson) { console.log(JSON.stringify({ ok: false, diagnostics: [{ level: 'error', message }] })); }
        else { console.error(message); }
        process.exitCode = 1;
    }
}
