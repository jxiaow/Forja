/**
 * SSH/SCP 传输层 — 负责远程文件操作。
 * 密码模式通过 SSH_ASKPASS 机制实现：
 *   - Windows: 生成 PowerShell 脚本，密码通过环境变量传入（避免 cmd 转义问题）
 *   - Linux/macOS: 生成 bash 脚本，密码通过环境变量传入
 * 关键：spawn 时 stdio 不能是 'inherit'，必须是 pipe，这样 ssh 检测不到 TTY 才会调用 ASKPASS。
 */
// ── 公共 SSH/SCP 参数构建（从 core/ssh 导入并 re-export） ──

export { buildSshArgs, buildScpArgs, sshTarget, SshArgsOptions } from '../core/ssh';

// ── 公共操作 ──

export {
    CancellationTokenLike,
    ensureRemoteDir,
    isCancellationError,
    scpUpload,
    TestConnectionResult,
    testConnection
} from '../core/sshTransport';
