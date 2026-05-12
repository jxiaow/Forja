/**
 * 简单的密码加密/解密。
 * 密钥存储在 ~/.qt-pilot/.key，首次使用时自动生成。
 * 不依赖 vscode，CLI 和扩展都可用。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ALGORITHM = 'aes-256-cbc';
const PREFIX = 'enc:';

function _keyFilePath(): string {
    return path.join(os.homedir(), '.qt-pilot', '.key');
}

function _getOrCreateKey(): Buffer {
    const keyFile = _keyFilePath();
    try {
        if (fs.existsSync(keyFile)) {
            const hex = fs.readFileSync(keyFile, 'utf-8').trim();
            if (hex.length === 64) {
                return Buffer.from(hex, 'hex');
            }
        }
    } catch {}

    // 生成新密钥
    const key = crypto.randomBytes(32);
    const dir = path.dirname(keyFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
    return key;
}

export function encrypt(plainText: string): string {
    if (!plainText) { return ''; }
    const key = _getOrCreateKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return PREFIX + iv.toString('hex') + ':' + encrypted;
}

export function decrypt(stored: string): string {
    if (!stored) { return ''; }
    if (!stored.startsWith(PREFIX)) {
        // 未加密的明文（兼容旧数据）
        return stored;
    }
    try {
        const payload = stored.slice(PREFIX.length);
        const [ivHex, encrypted] = payload.split(':');
        const key = _getOrCreateKey();
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch {
        return '';
    }
}

export function isEncrypted(value: string): boolean {
    return value.startsWith(PREFIX);
}
