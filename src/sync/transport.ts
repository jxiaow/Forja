/**
 * SSH/SCP 传输层 — 负责远程文件操作。
 * Windows 密码模式通过 SSH_ASKPASS + 临时脚本实现（无需 sshpass）。
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ServerConfig } from './serverStore';

/**
 * 创建临时 askpass 脚本，用于 SSH_ASKPASS 非交互式密码传入。
 * Windows 下生成 .bat，Linux/Mac 下生成 .sh。
 */
function _createAskpassScript(password: string): string {
    const tmpDir = os.tmpdir();
    if (process.platform === 'win32') {
        const script = path.join(tmpDir, `qt-pilot-askpass-${process.pid}.bat`);
        fs.writeFileSync(script, `@echo off\r\necho ${password}\r\n`, { mode: 0o700 });
        return script;
    } else {
        const script = path.join(tmpDir, `qt-pilot-askpass-${process.pid}.sh`);
        fs.writeFileSync(script, `#!/bin/sh\necho '${password.replace(/'/g, "'\\''")}'\\n`, { mode: 0o700 });
        return script;
    }
}

function _removeAskpassScript(): void {
    const tmpDir = os.tmpdir();
    const ext = process.platform === 'win32' ? '.bat' : '.sh';
    const script = path.join(tmpDir, `qt-pilot-askpass-${process.pid}${ext}`);
    try { fs.unlinkSync(script); } catch {}
}

/**
 * 构建密码模式的 spawn 环境变量。
 * 使用 SSH_ASKPASS + DISPLAY 让 ssh/scp 从脚本读取密码。
 */
function _passwordEnv(askpassScript: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        SSH_ASKPASS: askpassScript,
        SSH_ASKPASS_REQUIRE: 'force',
        DISPLAY: ':0'
    };
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

        let env: NodeJS.ProcessEnv | undefined;
        let askpass: string | null = null;
        if (server.authMode === 'password' && password) {
            askpass = _createAskpassScript(password);
            env = _passwordEnv(askpass);
        }

        const proc = cp.spawn('scp', args, { windowsHide: true, env });
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

        let env: NodeJS.ProcessEnv | undefined;
        let askpass: string | null = null;
        if (server.authMode === 'password' && password) {
            askpass = _createAskpassScript(password);
            env = _passwordEnv(askpass);
        }

        const proc = cp.spawn('ssh', args, { windowsHide: true, env });
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
        sshArgs.push('-o', 'ConnectTimeout=5');
        if (server.authMode === 'key') {
            sshArgs.push('-o', 'BatchMode=yes');
        }

        const target = `${server.username}@${server.host}`;
        const args = [...sshArgs, target, 'echo ok'];

        let env: NodeJS.ProcessEnv | undefined;
        let askpass: string | null = null;
        if (server.authMode === 'password' && password) {
            askpass = _createAskpassScript(password);
            env = _passwordEnv(askpass);
        }

        const proc = cp.spawn('ssh', args, { windowsHide: true, env });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            if (askpass) { _removeAskpassScript(); }
            if (code === 0 && stdout.trim() === 'ok') { resolve({ ok: true }); }
            else { resolve({ ok: false, error: stderr.trim() || `exit code ${code}` }); }
        });
        proc.on('error', (e) => {
            if (askpass) { _removeAskpassScript(); }
            resolve({ ok: false, error: e.message });
        });
    });
}
