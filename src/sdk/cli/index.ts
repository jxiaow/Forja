/**
 * SDK CLI entry point — called by the unified compilot dispatcher.
 * Provides build/rebuild/clean/status operations for .sln and Makefile projects.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { EXCLUDE_DIRS, DEFAULT_SCAN_DEPTH } from '../constants';

interface SdkCliOptions {
    action: string;
    workspace: string;
    project: string | null;
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    execute: boolean;
    json: boolean;
}

interface SdkCliResult {
    ok: boolean;
    action: string;
    target: string | null;
    workspace: string;
    project: string | null;
    commands: string[];
    shellCommand: string | null;
    exitCode: number | null;
    diagnostics: Array<{ level: string; message: string; hint?: string }>;
    errors: string[];
}

function parseArgs(argv: string[]): SdkCliOptions {
    const VALID_ACTIONS = ['build', 'rebuild', 'clean', 'status'];

    const options: SdkCliOptions = {
        action: argv[0] || 'status',
        workspace: process.cwd(),
        project: null,
        mode: 'debug',
        arch: 'x86',
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
                if (!val || val.startsWith('--')) { throw new Error('--mode 需要一个值 (debug 或 release)'); }
                options.mode = (argv[++i] as 'debug' | 'release');
                break;
            }
            case '--arch': {
                const val = argv[i + 1];
                if (!val || val.startsWith('--')) { throw new Error('--arch 需要一个值 (x86 或 x64)'); }
                options.arch = (argv[++i] as 'x86' | 'x64');
                break;
            }
            case '--execute':
                break;
            case '--plan':
            case '--dry-run':
                options.execute = false;
                break;
            case '--json':
                options.json = true;
                break;
            default:
                if (arg.startsWith('--')) {
                    throw new Error(`未知参数: ${arg}。使用 compilot sdk --help 查看可用选项`);
                }
                break;
        }
    }

    if (!VALID_ACTIONS.includes(options.action)) {
        throw new Error(`未知动作: ${options.action}。可用: ${VALID_ACTIONS.join(', ')}`);
    }
    if (!['debug', 'release'].includes(options.mode)) {
        throw new Error(`无效的 --mode 值: ${options.mode}。可用: debug, release`);
    }
    if (!['x86', 'x64'].includes(options.arch)) {
        throw new Error(`无效的 --arch 值: ${options.arch}。可用: x86, x64`);
    }

    options.workspace = path.resolve(options.workspace);
    if (!fs.existsSync(options.workspace)) {
        throw new Error(`工作区目录不存在: ${options.workspace}`);
    }
    return options;
}

export function scanProjects(workspace: string, depth: number = DEFAULT_SCAN_DEPTH): string[] {
    const results: string[] = [];
    const isWindows = os.platform() === 'win32';
    const pattern = isWindows ? /\.sln$/i : /^Makefile$/;

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
                if (!EXCLUDE_DIRS.includes(entry.name)) {
                    walk(path.join(dir, entry.name), currentDepth + 1);
                }
            } else if (entry.isFile() && pattern.test(entry.name)) {
                results.push(path.join(dir, entry.name));
            }
        }
    }

    walk(workspace, 0);
    return results;
}

function buildCommand(options: SdkCliOptions, projectPath: string): string[] {
    const isWindows = os.platform() === 'win32';

    if (isWindows && projectPath.endsWith('.sln')) {
        const msbuildAction = options.action === 'clean' ? 'Clean'
            : options.action === 'rebuild' ? 'Rebuild'
            : 'Build';
        const config = options.mode === 'release' ? 'Release' : 'Debug';
        const platform = options.arch === 'x64' ? 'x64' : 'Win32';
        return [
            `msbuild "${projectPath}" /t:${msbuildAction} /p:Configuration=${config} /p:Platform=${platform} /m`
        ];
    } else {
        // Makefile
        const makefileDir = path.dirname(projectPath);
        const target = options.action === 'clean' ? 'clean'
            : options.action === 'rebuild' ? 'clean all'
            : '';
        return [`make -C "${makefileDir}" ${target}`.trim()];
    }
}

function getHelpText(): string {
    return `
Compilot SDK CLI

用法:
  compilot sdk <action> [options]

动作:
  build     编译项目
  rebuild   重新编译（clean + build）
  clean     清理编译产物
  status    显示项目状态

选项:
  --workspace <path>   工作区路径（默认当前目录）
  --project <path>     项目入口文件路径（.sln 或 Makefile）
  --mode <mode>        编译模式: debug | release（默认 debug）
  --arch <arch>        目标架构: x86 | x64（默认 x86）
  --plan               仅输出命令计划，不执行
  --json               JSON 格式输出

示例:
  compilot sdk build --mode release --arch x64
  compilot sdk build --plan --json
  compilot sdk status --json
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

        // 查找项目
        let projectPath = options.project;
        if (!projectPath) {
            const candidates = scanProjects(options.workspace);
            if (candidates.length === 0) {
                const msg = '未找到 .sln 或 Makefile 项目文件';
                if (wantsJson) {
                    console.log(JSON.stringify({ ok: false, action: options.action, diagnostics: [{ level: 'error', message: msg }] }));
                } else {
                    console.error(msg);
                }
                process.exitCode = 1;
                return;
            }
            projectPath = candidates[0];
            if (candidates.length > 1 && !wantsJson) {
                console.log(`找到 ${candidates.length} 个项目，使用第一个: ${path.basename(projectPath)}`);
            }
        }

        if (options.action === 'status') {
            const candidates = scanProjects(options.workspace);
            const result = {
                ok: true,
                action: 'status',
                workspace: options.workspace,
                target: projectPath ? path.basename(projectPath, path.extname(projectPath)) : null,
                project: projectPath,
                candidates: candidates.map(c => path.relative(options.workspace, c) || c),
                mode: options.mode,
                arch: options.arch
            };
            if (wantsJson) {
                console.log(JSON.stringify(result, null, 2));
            } else {
                console.log(`工作区: ${options.workspace}`);
                console.log(`当前项目: ${projectPath}`);
                console.log(`模式: ${options.mode} / ${options.arch}`);
                if (candidates.length > 1) {
                    console.log(`候选项目:`);
                    candidates.forEach(c => console.log(`  ${path.relative(options.workspace, c)}`));
                }
            }
            return;
        }

        // 生成命令
        const commands = buildCommand(options, projectPath);
        const shellCommand = commands.join(' && ');

        const result: SdkCliResult = {
            ok: true,
            action: options.action,
            target: projectPath ? path.basename(projectPath, path.extname(projectPath)) : null,
            workspace: options.workspace,
            project: projectPath,
            commands,
            shellCommand: options.execute ? null : shellCommand,
            exitCode: null,
            diagnostics: [],
            errors: []
        };

        if (options.execute) {
            try {
                execSync(shellCommand, {
                    cwd: options.workspace,
                    stdio: wantsJson ? 'pipe' : 'inherit',
                    encoding: 'utf8'
                });
                result.exitCode = 0;
            } catch (e: unknown) {
                result.ok = false;
                result.exitCode = (e as { status?: number }).status ?? 1;
                result.errors.push(`编译失败，退出码: ${result.exitCode}`);
            }
        }

        if (wantsJson) {
            console.log(JSON.stringify(result, null, 2));
        } else if (!options.execute) {
            console.log(`SDK ${options.action} 命令:`);
            commands.forEach(c => console.log(`  ${c}`));
            console.log(`\n使用 compilot sdk ${options.action} 执行（默认执行），或加 --plan 仅查看计划`);
        }

        process.exitCode = result.ok ? 0 : 1;
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (wantsJson) {
            console.log(JSON.stringify({ ok: false, diagnostics: [{ level: 'error', message }] }));
        } else {
            console.error(message);
        }
        process.exitCode = 1;
    }
}
