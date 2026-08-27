/**
 * C++ build plan creation — shared build command assembly.
 * Returns CliResult format to reuse Qt's runCliResult execution engine.
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { CliResult } from '../../core/types';

export interface CppPlanOptions {
    action: 'build' | 'rebuild' | 'clean';
    workspace: string;
    project: string;
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    vsDevCmdPath?: string;
    buildArgs?: string;
    jobs?: number;
}

/**
 * Read available platforms from .sln file for a given configuration.
 */
function readSolutionPlatforms(projectPath: string, configuration: string): string[] {
    let content = '';
    try {
        content = fs.readFileSync(projectPath, 'utf-8');
    } catch {
        return [];
    }

    const platforms: string[] = [];
    let inSection = false;
    for (const line of content.split(/\r?\n/)) {
        if (/GlobalSection\(SolutionConfigurationPlatforms\)/.test(line)) {
            inSection = true;
            continue;
        }
        if (inSection && /EndGlobalSection/.test(line)) {
            break;
        }
        if (!inSection) { continue; }

        const match = line.match(/^\s*([^|=]+)\|([^=]+?)\s*=/);
        if (!match) { continue; }
        if (match[1].trim().toLowerCase() !== configuration.toLowerCase()) { continue; }
        platforms.push(match[2].trim());
    }
    return platforms;
}

/**
 * Resolve the actual platform to use for msbuild based on .sln contents.
 * Falls back to hardcoded mapping if .sln cannot be read.
 */
function resolveSolutionPlatform(projectPath: string, configuration: string, arch: 'x86' | 'x64'): string {
    const fallback = arch === 'x64' ? 'x64' : 'Win32';
    const platforms = readSolutionPlatforms(projectPath, configuration);
    if (platforms.length === 0) { return fallback; }

    const preferred = arch === 'x64' ? ['x64'] : ['x86', 'Win32'];
    for (const candidate of preferred) {
        const found = platforms.find(p => p.toLowerCase() === candidate.toLowerCase());
        if (found) { return found; }
    }
    return fallback;
}

/**
 * Read the shebang line of a shell script to determine the interpreter.
 * Returns the interpreter command (e.g. "/bin/bash", "bash") or "sh" as fallback.
 */
function resolveShellInterpreter(scriptPath: string): string {
    try {
        const fd = fs.openSync(scriptPath, 'r');
        try {
            const buf = Buffer.alloc(256);
            fs.readSync(fd, buf, 0, 256, 0);
            const firstLine = buf.toString('utf8').split('\n')[0].trim();
            if (firstLine.startsWith('#!')) {
                const parts = firstLine.slice(2).trim().split(/\s+/);
                if (path.basename(parts[0]) === 'env') {
                    return parts[1] || 'sh';
                }
                return parts[0];
            }
        } finally {
            fs.closeSync(fd);
        }
    } catch { /* ignore */ }
    return 'sh';
}

/**
 * Build shell commands for C++ project (MSBuild on Windows, make on POSIX).
 * Single source of truth for C++ build command assembly.
 */
export function buildCommand(options: CppPlanOptions): string[] {
    const isWindows = os.platform() === 'win32';
    const projectExtension = path.extname(options.project).toLowerCase();
    const commands: string[] = [];

    if (isWindows && projectExtension === '.sln') {
        // Initialize VS environment
        if (options.vsDevCmdPath) {
            commands.push(`call "${options.vsDevCmdPath}" -arch=${options.arch} -no_logo`);
        }
        const msbuildAction = options.action === 'clean' ? 'Clean'
            : options.action === 'rebuild' ? 'Rebuild'
            : 'Build';
        const config = options.mode === 'release' ? 'Release' : 'Debug';
        // Resolve actual platform from .sln file
        const platform = resolveSolutionPlatform(options.project, config, options.arch);
        commands.push(`msbuild "${options.project}" /t:${msbuildAction} /p:Configuration=${config} /p:Platform=${platform}${options.jobs ? ` /m:${options.jobs}` : ' /m'}`);
    } else if (path.basename(options.project).toLowerCase() === 'cmakelists.txt') {
        const projectDir = path.dirname(options.project);
        const buildDir = path.join(projectDir, 'build');
        if (isWindows && options.vsDevCmdPath) {
            commands.push(`call "${options.vsDevCmdPath}" -arch=${options.arch} -no_logo`);
        }
        if (options.action === 'clean') {
            commands.push(`cmake --build "${buildDir}" --target clean`);
        } else {
            const configFlag = options.mode === 'release' ? '-DCMAKE_BUILD_TYPE=Release' : '-DCMAKE_BUILD_TYPE=Debug';
            commands.push(`cmake -B "${buildDir}" -S "${projectDir}" ${configFlag}`);
            const parallelFlag = options.jobs ? `--parallel ${options.jobs}` : '--parallel';
            const buildAction = options.action === 'rebuild' ? '--clean-first' : '';
            commands.push(`cmake --build "${buildDir}" ${buildAction} ${parallelFlag}`.trim());
        }
    } else if (projectExtension === '.sh' || projectExtension === '.bat') {
        // Custom build script — execute in its own directory
        if (options.action === 'clean') {
            throw new Error('Custom build scripts do not support generic clean');
        }
        const scriptDir = path.dirname(options.project);
        const scriptName = path.basename(options.project);
        const args = options.buildArgs ? ` ${options.buildArgs}` : '';
        if (projectExtension === '.bat') {
            commands.push(`cd "${scriptDir}" && call "${scriptName}"${args}`);
        } else {
            const interpreter = resolveShellInterpreter(options.project);
            commands.push(`cd "${scriptDir}" && ${interpreter} "${scriptName}"${args}`);
        }
    } else {
        const makefileDir = path.dirname(options.project);
        const target = options.action === 'clean' ? 'clean'
            : options.action === 'rebuild' ? 'clean all'
            : '';
        const jobsFlag = options.jobs ? `-j${options.jobs}` : '-j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)';
        commands.push(`make -C "${makefileDir}" ${target} ${jobsFlag}`.trim());
    }
    return commands;
}

/**
 * Create C++ build plan in CliResult format.
 * This allows reusing Qt's runCliResult execution engine.
 */
export function createCppPlan(options: CppPlanOptions): CliResult {
    const commands = buildCommand(options);
    const shellCommand = commands.join(' && ');

    return {
        ok: true,
        action: options.action === 'rebuild' ? 'build' : options.action, // Normalize to Qt action names
        mode: 'execute',
        workspace: options.workspace,
        project: options.project,
        commands,
        shellCommand,
        exitCode: null,
        durationMs: 0,
        stdout: '',
        stderr: '',
        errors: [],
        logFile: null,
        diagnostics: [],
        resolved: null,
    };
}
