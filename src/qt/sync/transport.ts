/**
 * SSH/SCP 传输层 — 负责远程文件操作。
 * Windows 密码模式通过 SSH_ASKPASS 机制实现（生成临时可执行脚本输出密码）。
 * 关键：spawn 时 stdio 不能是 'inherit'，必须是 pipe，这样 ssh 检测不到 TTY 才会调用 ASKPASS。
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ServerConfig } from './serverStore';

/**
 * 创建临时 askpass 可执行脚本。
 * ssh 在无 TTY 时会调用 SSH_ASKPASS 指定的程序来获取密码。
 */
function _createAskpassScript(password: string): string {
    const tmpDir = os.tmpdir();
    const scriptPath = path.join(tmpDir, `compilot-askpass-${process.pid}.bat`);
    // .bat 脚本：输出密码到 stdout
    fs.writeFileSync(scriptPath, `@echo off\r\necho ${password}\r\n`);
    return scriptPath;
}

function _removeAskpassScript(): void {
    const tmpDir = os.tmpdir();
    const scriptPath = path.join(tmpDir, `compilot-askpass-${process.pid}.bat`);
    try { fs.unlinkSync(scriptPath); } catch {}
}

interface PasswordSpawnOptions {
    args: string[];
    cmd: string;
    password: string | null;
    server: ServerConfig;
}

/**
 * 构建 spawn 选项。密码模式下设置 SSH_ASKPASS 环境变量。
 */
function _buildSpawnOptions(password: string | null): { env?: NodeJS.ProcessEnv; askpass: string | null } {
    if (!password) {
        return { env: undefined, askpass: null };
    }
    const askpass = _createAskpassScript(password);
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        SSH_ASKPASS: askpass,
        SSH_ASKPASS_REQUIRE: 'force',
        DISPLAY: '1'
    };
    return { env, askpass };
}

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
        const args = [...baseArgs, localFile, dest];

        const { env, askpass } = _buildSpawnOptions(
            server.authMode === 'password' ? password : null
        );

        const proc = cp.spawn('scp', args, {
            windowsHide: true,
            env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            if (askpass) { _removeAskpassScript(); }
            if (code === 0) { resolve(); }
            else { reject(new Error(`scp 失败 (code=${code}): ${stderr.trim()}`)); }
        });
        proc.on('error', (e) => {
            if (askpass) { _removeAskpassScript(); }
            reject(new Error(`scp 启动失败: ${e.message}`));
        });
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
        const args = [...sshArgs, `${server.username}@${server.host}`, cmd];

        const { env, askpass } = _buildSpawnOptions(
            server.authMode === 'password' ? password : null
        );

        const proc = cp.spawn('ssh', args, {
            windowsHide: true,
            env,
            stdio: ['pipe', 'pipe', 'pipe']
        });
        proc.on('close', () => { if (askpass) { _removeAskpassScript(); } resolve(); });
        proc.on('error', () => { if (askpass) { _removeAskpassScript(); } resolve(); });
    });
}

export interface TestConnectionResult {
    ok: boolean;
    error?: string;
}

/** 测试 SSH 连接 */
export function testConnection(server: ServerConfig, password: string | null): Promise<TestConnectionResult> {
    return new Promise((resolve) => {
        const sshArgs: string[] = [];
        if (server.authMode === 'key' && server.privateKeyPath) {
            sshArgs.push('-i', server.privateKeyPath);
        }
        sshArgs.push('-p', String(server.port));
        sshArgs.push('-o', 'StrictHostKeyChecking=no');
        sshArgs.push('-o', 'ConnectTimeout=10');
        if (server.authMode === 'key') {
            sshArgs.push('-o', 'BatchMode=yes');
        }

        const target = `${server.username}@${server.host}`;
        const args = [...sshArgs, target, 'echo ok'];

        const { env, askpass } = _buildSpawnOptions(
            server.authMode === 'password' ? password : null
        );

        const proc = cp.spawn('ssh', args, {
            windowsHide: true,
            env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        // 超时保护：15 秒后强制 kill
        const timer = setTimeout(() => {
            proc.kill();
            if (askpass) { _removeAskpassScript(); }
            resolve({ ok: false, error: '连接超时（15s）' });
        }, 15000);

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (askpass) { _removeAskpassScript(); }
            if (code === 0 && stdout.trim() === 'ok') { resolve({ ok: true }); }
            else { resolve({ ok: false, error: stderr.trim() || `exit code ${code}` }); }
        });
        proc.on('error', (e) => {
            clearTimeout(timer);
            if (askpass) { _removeAskpassScript(); }
            resolve({ ok: false, error: e.message });
        });
    });
}
