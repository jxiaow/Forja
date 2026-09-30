/**
 * 子进程输出解码 — Windows 传统工具（cmd/jom 等）可能输出 GBK，需要平台层兜底；
 * 其余平台直接按 UTF-8 解码。
 */

/**
 * 将子进程输出的 Buffer 解码为字符串。
 * 优先尝试 UTF-8（MSBuild 等现代工具），失败则退回 GBK（传统 cmd/jom 等）。
 */
export function decodeWinOutput(buffer: Buffer): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        // Not valid UTF-8 — fall back to GBK for legacy Windows tools
        try {
            return new TextDecoder('gbk', { fatal: false }).decode(buffer);
        } catch {
            return buffer.toString('utf-8');
        }
    }
}

/** 按当前平台约定解码子进程输出（Windows 走 GBK 兜底，其余平台 UTF-8） */
export function decodeProcessOutput(buffer: Buffer): string {
    return process.platform === 'win32' ? decodeWinOutput(buffer) : buffer.toString('utf-8');
}
