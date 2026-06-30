/**
 * SDK build plan creation — extracts core logic from sdk/cli/index.ts
 * Returns CliResult format to reuse Qt's runCliResult execution engine.
 */
import * as os from 'os';
import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import { CliResult } from '../../core/types';

export interface SdkPlanOptions {
    action: 'build' | 'rebuild' | 'clean';
    workspace: string;
    project: string;
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    vsDevCmdPath?: string;
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
 * Build shell commands for SDK project (MSBuild on Windows, make on POSIX).
 * Single source of truth for SDK build command assembly.
 */
export function buildCommand(options: SdkPlanOptions): string[] {
    const isWindows = os.platform() === 'win32';
    const commands: string[] = [];

    if (isWindows && options.project.endsWith('.sln')) {
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
        commands.push(`msbuild "${options.project}" /t:${msbuildAction} /p:Configuration=${config} /p:Platform=${platform} /m`);
    } else {
        const makefileDir = path.dirname(options.project);
        const target = options.action === 'clean' ? 'clean'
            : options.action === 'rebuild' ? 'clean all'
            : '';
        commands.push(`make -C "${makefileDir}" ${target} -j$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)`.trim());
    }
    return commands;
}

/**
 * Extract error lines from compiler output.
 */
export function extractSdkErrors(output: string): string[] {
    const errorPattern = /\): error |:\s+error\s+[A-Z]+\d+:|: error:|: fatal error |: fatal error:/i;
    return output.split(/\r?\n/).filter(l => errorPattern.test(l)).slice(0, 20);
}

/**
 * Create SDK build plan in CliResult format.
 * This allows reusing Qt's runCliResult execution engine.
 */
export function createSdkPlan(options: SdkPlanOptions): CliResult {
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

/**
 * Execute async command (for SDK builds).
 * Reuses the same pattern as Qt's commandRunner.
 */
export function executeSdkAsync(commandLine: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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
