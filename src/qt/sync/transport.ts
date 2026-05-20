/**
 * SSH/SCP 传输层 — 负责远程文件操作。
 * 密码模式通过 SSH_ASKPASS 机制实现：
 *   - Windows: 生成 PowerShell 脚本，密码通过环境变量传入（避免 cmd 转义问题）
 *   - Linux/macOS: 生成 bash 脚本，密码通过环境变量传入
 * 关键：spawn 时 stdio 不能是 'inherit'，必须是 pipe，这样 ssh 检测不到 TTY 才会调用 ASKPASS。
 */
import * as cp from 'child_process';
import { ServerConfig } from '../../core/serverStore';

// ── 公共 SSH/SCP 参数构建（从 core/ssh 导入并 re-export） ──

import { buildSshArgs, buildScpArgs, sshTarget, createAskpassEnv } from '../../core/ssh';
export { buildSshArgs, buildScpArgs, sshTarget, SshArgsOptions } from '../../core/ssh';

// ── 公共操作 ──

/** SCP 上传单个文件 */
export function scpUpload(server: ServerConfig, localFile: string, remoteFile: string, password: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
        const baseArgs = buildScpArgs(server);
        // Windows scp 不需要单引号包裹远程路径；Linux/macOS 需要防止 shell 展开
        const dest = process.platform === 'win32'
            ? `${sshTarget(server)}:${remoteFile}`
            : `${sshTarget(server)}:'${remoteFile.replace(/'/g, "'\\''")}'`;
        const args = [...baseArgs, localFile, dest];

        const askpass = createAskpassEnv(
            server.authMode === 'password' ? password : null, `transport-${process.pid}`
        );

        const proc = cp.spawn('scp', args, {
            windowsHide: true,
            env: askpass?.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            askpass?.cleanup();
            if (code === 0) { resolve(); }
            else { reject(new Error(`scp 失败 (code=${code}): ${stderr.trim()}`)); }
        });
        proc.on('error', (e) => {
            askpass?.cleanup();
            reject(new Error(`scp 启动失败: ${e.message}`));
        });
    });
}

/** 确保远程目录存在 */
export function ensureRemoteDir(server: ServerConfig, remoteDir: string, password: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
        const sshArgs = buildSshArgs(server);
        const escaped = remoteDir.replace(/'/g, "'\\''");
        const cmd = `mkdir -p '${escaped}'`;
        const args = [...sshArgs, sshTarget(server), cmd];

        const askpass = createAskpassEnv(
            server.authMode === 'password' ? password : null, `mkdir-${process.pid}`
        );

        const proc = cp.spawn('ssh', args, {
            windowsHide: true,
            env: askpass?.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stderr = '';
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            askpass?.cleanup();
            // mkdir -p 失败不阻塞（目录可能已存在）
            if (code !== 0 && stderr) {
                console.warn(`[compilot] ensureRemoteDir (code=${code}): ${stderr.trim()}`);
            }
            resolve();
        });
        proc.on('error', () => { askpass?.cleanup(); resolve(); });
    });
}

export interface TestConnectionResult {
    ok: boolean;
    error?: string;
}

/** 测试 SSH 连接 */
export function testConnection(server: ServerConfig, password: string | null): Promise<TestConnectionResult> {
    return new Promise((resolve) => {
        const sshArgs = buildSshArgs(server, { extraOptions: ['ConnectTimeout=10'] });
        const target = sshTarget(server);
        const args = [...sshArgs, target, 'echo ok'];

        const askpass = createAskpassEnv(
            server.authMode === 'password' ? password : null, `transport-${process.pid}`
        );

        const proc = cp.spawn('ssh', args, {
            windowsHide: true,
            env: askpass?.env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        // 超时保护：15 秒后强制 kill
        const timer = setTimeout(() => {
            proc.kill();
            askpass?.cleanup();
            resolve({ ok: false, error: '连接超时（15s）' });
        }, 15000);

        proc.on('close', (code) => {
            clearTimeout(timer);
            askpass?.cleanup();
            if (code === 0 && stdout.trim() === 'ok') { resolve({ ok: true }); }
            else { resolve({ ok: false, error: stderr.trim() || `exit code ${code}` }); }
        });
        proc.on('error', (e) => {
            clearTimeout(timer);
            askpass?.cleanup();
            resolve({ ok: false, error: e.message });
        });
    });
}
