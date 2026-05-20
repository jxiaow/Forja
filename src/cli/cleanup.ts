/**
 * compilot cleanup — 清理已删除/移动项目的残留配置文件。
 *
 * 扫描 ~/.compilot/projects/ 下所有配置文件，检查其 workspace 路径是否仍然存在。
 * 不存在的配置文件列出并可选删除。
 */
import * as fs from 'fs';
import { listProjectConfigs } from '../core/settingsIO';

export function runCleanup(argv: string[]): void {
    const wantsJson = argv.includes('--json');
    const dryRun = argv.includes('--plan') || argv.includes('--dry-run');

    const configs = listProjectConfigs();
    const stale: Array<{ filePath: string; workspace: string; type: string }> = [];

    for (const config of configs) {
        if (!fs.existsSync(config.workspace)) {
            stale.push(config);
        }
    }

    if (stale.length === 0) {
        if (wantsJson) {
            console.log(JSON.stringify({ ok: true, action: 'cleanup', removed: 0, message: '没有需要清理的配置' }));
        } else {
            console.log('没有需要清理的残留配置。');
        }
        return;
    }

    if (dryRun) {
        if (wantsJson) {
            console.log(JSON.stringify({
                ok: true,
                action: 'cleanup',
                mode: 'dryRun',
                stale: stale.map(s => ({ workspace: s.workspace, type: s.type, file: s.filePath }))
            }, null, 2));
        } else {
            console.log(`发现 ${stale.length} 个残留配置（--plan 模式，不删除）：`);
            for (const s of stale) {
                console.log(`  [${s.type}] ${s.workspace}`);
            }
            console.log('\n去掉 --plan 执行清理。');
        }
        return;
    }

    // Execute cleanup
    let removed = 0;
    const errors: string[] = [];

    for (const s of stale) {
        try {
            fs.unlinkSync(s.filePath);
            removed++;
        } catch (e) {
            errors.push(`${s.filePath}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    if (wantsJson) {
        const out: Record<string, unknown> = { ok: errors.length === 0, action: 'cleanup', removed };
        if (errors.length > 0) { out.errors = errors; }
        console.log(JSON.stringify(out, null, 2));
    } else {
        console.log(`已清理 ${removed} 个残留配置。`);
        if (errors.length > 0) {
            console.error('部分文件删除失败：');
            errors.forEach(e => console.error(`  ${e}`));
        }
    }

    process.exitCode = errors.length > 0 ? 1 : 0;
}
