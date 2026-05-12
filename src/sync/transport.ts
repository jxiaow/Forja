/**
 * SSH/SCP 传输层 — 负责远程文件操作。
 */
import * as cp from 'child_process';
import { ServerConfig } from './serverStore';

/** SCP 上传单个文件 */
export function scpUpload(server: ServerConfig, localFile: string, remoteFile: string, password: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
        const baseArgs: string[] = [];
        if (server.authMode === 'key' && server.privateKeyPath) {
            baseArgs.push('-i', server.privateKeyPath);
        }
        if (server.port !== 22) {
            baseArgs.push('-P', String(server.port));
        }
        baseArgs.push('-o', 'StrictHostKeyChecking=no');
        if (server.authMode === 'key') {
            baseArgs.push('-o', 'BatchMode=yes');
        }

        const dest = `${server.username}@${server.host}:${remoteFile}`;

        if (server.authMode === 'password' && password) {
            const args = ['-p', password, 'scp', ...baseArgs, localFile, dest];
            const proc = cp.spawn('sshpass', args, { windowsHide: true });
            let stderr = '';
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                if (code === 0) { resolve(); }
                else { reject(new Error(`scp 失败 (code=${code}): ${stderr.trim()}`)); }
            });
            proc.on('error', () => {
                reject(new Error(
                    '密码认证需要 sshpass 工具。解决方案：\n' +
                    '1. 安装 Git for Windows 并使用 Git Bash 中的 sshpass\n' +
                    '2. 或改用 SSH 密钥认证（推荐）：ssh-keygen 生成密钥后 ssh-copy-id 推送到服务器'
                ));
            });
        } else {
            const args = [...baseArgs, localFile, dest];
            const proc = cp.spawn('scp', args, { windowsHide: true });
            let stderr = '';
            proc.stderr.on('data', (d) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                if (code === 0) { resolve(); }
                else { reject(new Error(`scp 失败 (code=${code}): ${stderr.trim()}`)); }
            });
            proc.on('error', (e) => {
                reject(new Error(`scp 启动失败: ${e.message}`));
            });
        }
    });
}

/** 确保远程目录存在 */
export function ensureRemoteDir(server: ServerConfig, remoteDir: string, password: string | null): Promise<void> {
    return new Promise((resolve) => {
        const sshArgs: string[] = [];
        if (server.authMode === 'key' && server.privateKeyPath) {
            sshArgs.push('-i', server.privateKeyPath);
        }
        sshArgs.push('-p', String(server.port));
        sshArgs.push('-o', 'StrictHostKeyChecking=no');
        if (server.authMode === 'key') {
            sshArgs.push('-o', 'BatchMode=yes');
        }

        const cmd = `mkdir -p "${remoteDir}"`;

        if (server.authMode === 'password' && password) {
            const args = ['-p', password, 'ssh', ...sshArgs, `${server.username}@${server.host}`, cmd];
            const proc = cp.spawn('sshpass', args, { windowsHide: true });
            proc.on('close', () => resolve());
            proc.on('error', () => resolve());
        } else {
            const args = [...sshArgs, `${server.username}@${server.host}`, cmd];
            const proc = cp.spawn('ssh', args, { windowsHide: true });
            proc.on('close', () => resolve());
            proc.on('error', () => resolve());
        }
    });
}

/** 测试 SSH 连接 */
export function testConnection(server: ServerConfig, password: string | null): Promise<boolean> {
    return new Promise((resolve) => {
        const sshArgs: string[] = [];
        if (server.authMode === 'key' && server.privateKeyPath) {
            sshArgs.push('-i', server.privateKeyPath);
        }
        sshArgs.push('-p', String(server.port));
        sshArgs.push('-o', 'StrictHostKeyChecking=no');
        sshArgs.push('-o', 'ConnectTimeout=5');
        if (server.authMode === 'key') {
            sshArgs.push('-o', 'BatchMode=yes');
        }

        const target = `${server.username}@${server.host}`;

        if (server.authMode === 'password' && password) {
            const args = ['-p', password, 'ssh', ...sshArgs, target, 'echo ok'];
            const proc = cp.spawn('sshpass', args, { windowsHide: true });
            let stdout = '';
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.on('close', (code) => { resolve(code === 0 && stdout.trim() === 'ok'); });
            proc.on('error', () => resolve(false));
        } else {
            const args = [...sshArgs, target, 'echo ok'];
            const proc = cp.spawn('ssh', args, { windowsHide: true });
            let stdout = '';
            proc.stdout.on('data', (d) => { stdout += d.toString(); });
            proc.on('close', (code) => { resolve(code === 0 && stdout.trim() === 'ok'); });
            proc.on('error', () => resolve(false));
        }
    });
}
