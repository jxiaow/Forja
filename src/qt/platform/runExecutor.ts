import { createLinuxRunExecutor } from './linux/runExecutor';
import { createWindowsRunExecutor } from './win/runExecutor';

export interface PlatformRunRequest {
    executablePath: string;
    cwd: string;
    qtPath?: string;
    detached: boolean;
    outputFile?: string;
    onStdout?: (chunk: Buffer) => void;
    onStderr?: (chunk: Buffer) => void;
}

export interface PlatformRunResult {
    pid: number;
    exitCode: number | null;
}

export interface PlatformRunExecutor {
    execute(request: PlatformRunRequest): Promise<PlatformRunResult>;
}

export function createPlatformRunExecutor(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform
): PlatformRunExecutor | undefined {
    return platform === 'win32'
        ? createWindowsRunExecutor(env)
        : createLinuxRunExecutor();
}
