#!/usr/bin/env node
/**
 * Compilot CLI — unified entry point.
 * Dispatches to Qt or SDK subcommand handlers.
 *
 * Usage:
 *   compilot qt <action> [options]
 *   compilot sdk <action> [options]
 */

import { runQtCli } from '../qt/cli/index';
import { runSdkCli } from '../sdk/cli/index';
import { VERSION } from '../version';


function printHelp(): void {
    const help = `
Compilot v${VERSION} — C++ 项目构建工具

用法:
  compilot <subcommand> [action] [options]

子命令:
  qt       Qt/qmake 项目操作 (init, env, projects, status, qmake, build, run, clean, stop, sync, rcc, logs)
  sdk      SDK/库项目操作 (build, rebuild, clean, status)

全局选项:
  --help, -h     显示帮助
  --version, -v  显示版本
  --json         JSON 格式输出

示例:
  compilot qt build --json
  compilot sdk build --workspace ./my-sdk
  compilot qt status --json
  compilot qt build --plan --json      查看计划（不执行）
`.trim();
    console.log(help);
}

async function main(argv: string[]): Promise<void> {
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
        default: {
            const wantsJson = argv.includes('--json');
            const msg = `未知子命令: ${subcommand}。可用子命令: qt, sdk`;
            if (wantsJson) {
                console.log(JSON.stringify({ ok: false, diagnostics: [{ level: 'error', message: msg }] }));
            } else {
                console.error(msg);
                console.error('使用 compilot --help 查看帮助');
            }
            process.exitCode = 1;
        }
    }
}

void main(process.argv.slice(2));
