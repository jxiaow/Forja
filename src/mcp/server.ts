#!/usr/bin/env node
/**
 * Qt Pilot MCP Server
 *
 * Exposes Qt project build operations as MCP tools.
 * Runs over stdio transport — designed for AI coding tools like Kiro, Claude Desktop, etc.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createActionPlan } from '../coreCli/qtCore';
import { runCliResult } from '../coreCli/commandRunner';
import { CliOptions } from '../cli/types';

const server = new McpServer({
    name: 'qt-pilot',
    version: '0.4.0'
});

// ── Shared option schema pieces ──

const workspaceSchema = z.string().optional().describe('工作区路径（默认当前目录）');
const projectSchema = z.string().optional().describe('.pro 文件路径');
const modeSchema = z.enum(['debug', 'release']).optional().describe('构建模式');
const archSchema = z.enum(['x86', 'x64']).optional().describe('目标架构');
const qtPathSchema = z.string().optional().describe('Qt 安装路径');
const vsDevShellSchema = z.string().optional().describe('Launch-VsDevShell.ps1 路径');
const targetSchema = z.string().optional().describe('QMake TARGET 覆盖');
const executeSchema = z.boolean().optional().default(false).describe('是否执行（false=dry-run 仅返回命令计划）');

function buildOptions(params: {
    workspace?: string;
    project?: string;
    mode?: 'debug' | 'release';
    arch?: 'x86' | 'x64';
    qtPath?: string;
    vsDevShell?: string;
    target?: string;
    execute?: boolean;
}, action: CliOptions['action']): CliOptions {
    return {
        action,
        executionMode: params.execute ? 'execute' : 'dryRun',
        workspace: params.workspace || null,
        project: params.project || null,
        mode: params.mode || null,
        arch: params.arch || null,
        qtPath: params.qtPath || null,
        vsDevShell: params.vsDevShell || null,
        target: params.target || null,
        saveLocal: false,
        json: true
    };
}

async function runAction(params: Record<string, unknown>, action: CliOptions['action']): Promise<string> {
    const options = buildOptions(params as any, action);
    const planned = await createActionPlan(options);
    const result = await runCliResult(planned);
    return JSON.stringify(result, null, 2);
}

// ── Tools ──

server.tool(
    'qt_status',
    '查看当前 Qt 项目状态：已解析的配置、候选项目、环境检测结果',
    {
        workspace: workspaceSchema
    },
    async (params) => ({
        content: [{ type: 'text', text: await runAction({ ...params, execute: false }, 'status') }]
    })
);

server.tool(
    'qt_init',
    '初始化 Qt 项目本地配置：检测环境、扫描 .pro 文件、写入 .work/qt-pilot/',
    {
        workspace: workspaceSchema,
        project: projectSchema,
        mode: modeSchema,
        arch: archSchema,
        qtPath: qtPathSchema,
        vsDevShell: vsDevShellSchema,
        execute: executeSchema
    },
    async (params) => ({
        content: [{ type: 'text', text: await runAction(params, 'init') }]
    })
);

server.tool(
    'qt_qmake',
    '生成或执行 qmake 命令（生成 Makefile）',
    {
        workspace: workspaceSchema,
        project: projectSchema,
        mode: modeSchema,
        arch: archSchema,
        qtPath: qtPathSchema,
        vsDevShell: vsDevShellSchema,
        target: targetSchema,
        execute: executeSchema
    },
    async (params) => ({
        content: [{ type: 'text', text: await runAction(params, 'qmake') }]
    })
);

server.tool(
    'qt_build',
    '生成或执行构建命令（编译项目）',
    {
        workspace: workspaceSchema,
        project: projectSchema,
        mode: modeSchema,
        arch: archSchema,
        qtPath: qtPathSchema,
        vsDevShell: vsDevShellSchema,
        target: targetSchema,
        execute: executeSchema
    },
    async (params) => ({
        content: [{ type: 'text', text: await runAction(params, 'build') }]
    })
);

server.tool(
    'qt_clean',
    '生成或执行清理命令',
    {
        workspace: workspaceSchema,
        project: projectSchema,
        mode: modeSchema,
        arch: archSchema,
        qtPath: qtPathSchema,
        vsDevShell: vsDevShellSchema,
        execute: executeSchema
    },
    async (params) => ({
        content: [{ type: 'text', text: await runAction(params, 'clean') }]
    })
);

server.tool(
    'qt_run',
    '构建并运行项目（execute=true 时先 build 再启动可执行文件）',
    {
        workspace: workspaceSchema,
        project: projectSchema,
        mode: modeSchema,
        arch: archSchema,
        qtPath: qtPathSchema,
        vsDevShell: vsDevShellSchema,
        target: targetSchema,
        execute: executeSchema
    },
    async (params) => ({
        content: [{ type: 'text', text: await runAction(params, 'run') }]
    })
);

server.tool(
    'qt_stop',
    '停止运行中的 Qt 程序',
    {
        workspace: workspaceSchema,
        project: projectSchema,
        execute: z.boolean().optional().default(true).describe('停止操作默认执行')
    },
    async (params) => ({
        content: [{ type: 'text', text: await runAction({ ...params, execute: params.execute ?? true }, 'stop') }]
    })
);

server.tool(
    'qt_detect',
    '检测 Qt 和 Visual Studio 环境（不写文件）',
    {
        workspace: workspaceSchema,
        qtPath: qtPathSchema,
        vsDevShell: vsDevShellSchema
    },
    async (params) => ({
        content: [{ type: 'text', text: await runAction({ ...params, execute: false }, 'detect') }]
    })
);

server.tool(
    'qt_projects',
    '列出工作区内的 .pro 文件',
    {
        workspace: workspaceSchema
    },
    async (params) => ({
        content: [{ type: 'text', text: await runAction({ ...params, execute: false }, 'projects') }]
    })
);

// ── Start ──

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
