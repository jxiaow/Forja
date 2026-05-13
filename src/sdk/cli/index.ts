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
    workspace: string;
    project: string | null;
    commands: string[];
    shellCommand: string | null;
    exitCode: number | null;
    diagnostics: Array<{ level: string; message: string; hint?: string }>;
    errors: string[];
}

function parseArgs(argv: string[]): SdkCliOptions {
    const options: SdkCliOptions = {
        action: argv[0] || 'status',
        workspace: process.cwd(),
        project: null,
        mode: 'debug',
        arch: 'x86',
        execute: false,
        json: false
    };

    for (let i = 1; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '--workspace':
                options.workspace = argv[++i] || process.cwd();
                break;
            case '--project':
                options.project = argv[++i] || null;
                break;
            case '--mode':
                options.mode = (argv[++i] as 'debug' | 'release') || 'debug';
                break;
            case '--arch':
                options.arch = (argv[++i] as 'x86' | 'x64') || 'x86';
                break;
            case '--execute':
                options.execute = true;
                break;
            case '--json':
                options.json = true;
                break;
        }
    }

    options.workspace = path.resolve(options.workspace);
    return options;
}

function scanProjects(workspace: string, depth: number = DEFAULT_SCAN_DEPTH): string[] {
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
  --execute            执行命令（默认仅输出命令计划）
  --json               JSON 格式输出
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
            console.log(`\n使用 --execute 执行命令`);
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
