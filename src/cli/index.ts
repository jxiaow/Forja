#!/usr/bin/env node
/**
 * Forja CLI — unified entry point.
 * Dispatches to Qt, SDK, sync, or cleanup subcommand handlers.
 *
 * Usage:
 *   forja qt <action> [options]
 *   forja sdk <action> [options]
 *   forja sync [status|servers|add-server|update-server|remove-server] [options]
 */

import { runQtCli } from '../qt/cli/index';
import { runSdkCli } from '../sdk/cli/index';
import { runCleanup } from './cleanup';
import { runSyncCli } from '../sync/cli';
import { VERSION } from '../version';
import { setSilent } from '../core/loggerBase';


function printHelp(): void {
    const help = `
Forja v${VERSION} — C++ 项目构建工具

用法:
  forja <subcommand> [action] [options]

子命令:
  qt       Qt/qmake 项目操作 (init, env, projects, status, qmake, build, run, clean, stop, rcc, logs)
  sdk      SDK/库项目操作 (build, rebuild, clean, status)
  sync     同步服务器管理、状态检查与变更文件上传（基于 git diff）
  cleanup  清理已删除/移动项目的残留配置

全局选项:
  --help, -h     显示帮助
  --version, -v  显示版本
  --json         JSON 格式输出

示例:
  forja qt build --json
  forja sdk build --workspace ./my-sdk
  forja qt status --json
  forja qt build --plan --json      查看计划（不执行）
  forja sync status --json          查看同步配置状态
  forja sync servers --json         列举同步服务器
  forja sync --plan --json          预览待同步文件
`.trim();
    console.log(help);
}

async function main(argv: string[]): Promise<void> {
    if (argv.includes('--json')) {
        setSilent(true);
    }

    const subcommand = argv[0];

    if (!subcommand || subcommand === '--help' || subcommand === '-h') {
        printHelp();
        return;
    }

    if (subcommand === '--version' || subcommand === '-v') {
        console.log(VERSION);
        return;
    }

    const subArgs = argv.slice(1);

    switch (subcommand) {
        case 'qt':
            await runQtCli(subArgs);
            break;
        case 'sdk':
            await runSdkCli(subArgs);
            break;
        case 'sync':
            await runSyncCli(subArgs);
            break;
        case 'cleanup':
            runCleanup(subArgs);
            break;
        default: {
            const wantsJson = argv.includes('--json');
            const msg = `未知子命令: ${subcommand}。可用子命令: qt, sdk, sync, cleanup`;
            if (wantsJson) {
                console.log(JSON.stringify({ ok: false, diagnostics: [{ level: 'error', message: msg }] }));
            } else {
                console.error(msg);
                console.error('使用 forja --help 查看帮助');
            }
            process.exitCode = 1;
        }
    }
}

void main(process.argv.slice(2));
