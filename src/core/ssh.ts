/**
 * SSH/SCP 公共工具。
 * 纯 Node 模块，不依赖 vscode。
 * 被 remote/core/、qt/sync/transport、core/syncCli 共用。
 */
import { ServerConfig } from './serverStore';

export interface SshArgsOptions {
    /** 额外的 -o 选项 */
    extraOptions?: string[];
}

/**
 * 构建 SSH 连接参数（不含命令和目标）。
 * 返回的数组可直接拼接到 ssh 命令中。
 */
export function buildSshArgs(server: ServerConfig, options?: SshArgsOptions): string[] {
    const args: string[] = [];
    if (server.authMode === 'key' && server.privateKeyPath) {
        // spawn 不做 shell 展开，直接传原始路径即可（含空格也能正确处理）
        args.push('-i', server.privateKeyPath);
    }
    args.push('-p', String(server.port));
    args.push('-o', 'StrictHostKeyChecking=no');
    if (server.authMode === 'key') {
        args.push('-o', 'BatchMode=yes');
    }
    if (options?.extraOptions) {
        for (const opt of options.extraOptions) {
            args.push('-o', opt);
        }
    }
    return args;
}

/**
 * 构建 SCP 连接参数（不含源和目标路径）。
 * SCP 用 -P（大写）指定端口，和 SSH 的 -p（小写）不同。
 */
export function buildScpArgs(server: ServerConfig): string[] {
    const args: string[] = [];
    if (server.authMode === 'key' && server.privateKeyPath) {
        args.push('-i', server.privateKeyPath);
    }
    if (server.port !== 22) {
        args.push('-P', String(server.port));
    }
    args.push('-o', 'StrictHostKeyChecking=no');
    if (server.authMode === 'key') {
        args.push('-o', 'BatchMode=yes');
    }
    return args;
}

/**
 * 构建 SSH 目标字符串（user@host）。
 */
export function sshTarget(server: ServerConfig): string {
    return `${server.username}@${server.host}`;
}

// ── ASKPASS 统一方案 ──

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ASKPASS_ENV_VAR = 'COMPILOT_SSH_PASS';

export interface AskpassEnv {
    env: NodeJS.ProcessEnv;
    cleanup: () => void;
}

/**
 * 创建 ASKPASS 环境。密码通过环境变量传入子进程，脚本本身不含密码明文。
 * 返回 spawn 用的 env 和清理函数。password 为 null 时返回 undefined。
 */
export function createAskpassEnv(password: string | null, suffix?: string): AskpassEnv | undefined {
    if (!password) { return undefined; }

    try {
        const tmpDir = os.tmpdir();
        const tag = suffix || process.pid.toString();
        let scriptPath: string;

        if (process.platform === 'win32') {
            scriptPath = path.join(tmpDir, `compilot-askpass-${tag}.ps1`);
            fs.writeFileSync(scriptPath, `Write-Host -NoNewline $env:${ASKPASS_ENV_VAR}\n`);
        } else {
            scriptPath = path.join(tmpDir, `compilot-askpass-${tag}.sh`);
            fs.writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s' "$${ASKPASS_ENV_VAR}"\n`, { mode: 0o700 });
        }

        const sshAskpass = process.platform === 'win32'
            ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`
            : scriptPath;

        const env: NodeJS.ProcessEnv = {
            ...process.env,
            SSH_ASKPASS: sshAskpass,
            SSH_ASKPASS_REQUIRE: 'force',
            DISPLAY: '1',
            [ASKPASS_ENV_VAR]: password
        };

        const cleanup = () => { try { fs.unlinkSync(scriptPath); } catch {} };

        return { env, cleanup };
    } catch (e) {
        console.warn(`[compilot] createAskpassEnv 失败: ${e instanceof Error ? e.message : e}`);
        return undefined;
    }
}
