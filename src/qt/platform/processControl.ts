/**
 * 进程控制 — 终止进程的跨平台差异收拢在此；调用方自行捕获异常（进程可能已退出）。
 */
import * as cp from 'child_process';

/**
 * 终止指定进程：Windows 用 taskkill 强杀进程树，其余平台发送 SIGTERM。
 */
export function killProcess(pid: number): void {
    if (process.platform === 'win32') {
        cp.execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    } else {
        process.kill(pid, 'SIGTERM');
    }
}
