import { CliAction, CliArch, CliBuildMode, CliOptions } from './types';

const validActions: CliAction[] = ['init', 'use', 'status', 'env', 'projects', 'qmake', 'build', 'clean', 'run', 'stop', 'ps', 'rcc'];

const helpText = `Forja Qt CLI — qmake 项目构建工具

用法: forja qt <command> [options]

命令:
  init        自动初始化本地配置（检测环境、保存可自动确定的配置）
  use         确认/切换当前 workspace 使用的项目和构建配置
  env         查看工具链环境（检测到的 Qt/VS/jom 及可选项）
  projects    查看 workspace 下的 .pro 文件列表
  status      显示当前配置、环境和项目状态
  qmake       生成/查看 qmake 命令
  build       构建项目
  clean       清理编译产物
  run         构建并运行
  stop        停止运行中的程序
  ps          查看后台运行状态
  rcc         编译 .qrc 资源文件为 .rcc 二进制

通用选项:
  --workspace <path>     工作区路径（默认当前目录）
  --json                 输出 JSON 格式（适合 AI 工具解析）
  --help, -h             显示此帮助信息

use 选项:
  --project <path>       指定当前 .pro 文件路径
  --mode debug|release   指定构建模式
  --arch x86|x64         指定目标架构
  --qt-path <path>       指定 Qt 安装路径
  --vs-dev-shell <path>  指定 Launch-VsDevShell.ps1 路径
  --target <name>        指定 QMake TARGET 覆盖
  --qmake-args <args>    指定追加到 qmake 命令末尾的自定义参数

执行选项:
  --plan                 仅生成命令计划，不执行（init/use/qmake/build/run/clean/rcc）
  --detach               run 成功构建后后台启动程序

示例:
  forja qt status --json            查看配置状态和下一步
  forja qt init --json              初始化并保存可自动确定的配置
  forja qt use --mode release       确认/切换到 release 配置
  forja qt build                    执行构建
  forja qt build --plan             查看构建命令（不执行）
  forja qt run --detach             后台构建并运行
  forja qt ps --json                查看后台运行状态
  forja qt status                   查看当前状态
`;

export function isHelpRequest(args: string[]): boolean {
    return args.includes('--help') || args.includes('-h');
}

export function getHelpText(): string {
    return helpText;
}

function isCliAction(value: string): value is CliAction {
    return validActions.includes(value as CliAction);
}

const knownFlags = new Set([
    '--plan',
    '--workspace',
    '--project',
    '--mode',
    '--arch',
    '--qt-path',
    '--vs-dev-shell',
    '--target',
    '--qmake-args',
    '--detach',
    '--json'
]);

const commonFlags = ['--workspace', '--json'];
const configFlags = ['--project', '--mode', '--arch', '--qt-path', '--vs-dev-shell', '--target', '--qmake-args'];
const planFlags = ['--plan'];
const actionAllowedFlags: Record<CliAction, Set<string>> = {
    init: new Set([...commonFlags, ...planFlags]),
    use: new Set([...commonFlags, ...planFlags, ...configFlags]),
    status: new Set(commonFlags),
    env: new Set(commonFlags),
    projects: new Set(commonFlags),
    qmake: new Set([...commonFlags, ...planFlags]),
    build: new Set([...commonFlags, ...planFlags]),
    clean: new Set([...commonFlags, ...planFlags]),
    run: new Set([...commonFlags, ...planFlags, '--detach']),
    stop: new Set(commonFlags),
    ps: new Set(commonFlags),
    rcc: new Set([...commonFlags, ...planFlags])
};

function assertFlagAllowedForAction(action: CliAction, flag: string): void {
    if (!flag.startsWith('--')) { return; }
    if (!knownFlags.has(flag)) {
        throw new Error(`未知参数: ${flag}`);
    }
    if (!actionAllowedFlags[action].has(flag)) {
        throw new Error(`${flag} 不能用于 ${action}`);
    }
}

function readValue(args: string[], index: number, flag: string): string {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${flag} 需要一个值`);
    }
    return value;
}

function parseMode(value: string): CliBuildMode {
    if (value === 'debug' || value === 'release') {
        return value;
    }
    throw new Error('--mode 只支持 debug 或 release');
}

function parseArch(value: string): CliArch {
    if (value === 'x86' || value === 'x64') {
        return value;
    }
    throw new Error('--arch 只支持 x86 或 x64');
}

export function parseCliArgs(args: string[]): CliOptions {
    const firstArg = args[0] || '';
    const actionText = firstArg.startsWith('--') || firstArg === '' ? 'status' : firstArg;
    if (!isCliAction(actionText)) {
        throw new Error(`未知命令: ${actionText}`);
    }

    const options: CliOptions = {
        action: actionText,
        executionMode: 'execute',
        workspace: null,
        project: null,
        mode: null,
        arch: null,
        qtPath: null,
        vsDevShell: null,
        target: null,
        qmakeArgs: null,
        detach: false,
        saveLocal: false,
        json: false
    };

    const startIndex = actionText === firstArg ? 1 : 0;

    for (let i = startIndex; i < args.length; i++) {
        const arg = args[i];
        assertFlagAllowedForAction(options.action, arg);

        switch (arg) {
            case '--plan':
                options.executionMode = 'dryRun';
                break;
            case '--workspace':
                options.workspace = readValue(args, i, arg);
                i++;
                break;
            case '--project':
                options.project = readValue(args, i, arg);
                i++;
                break;
            case '--mode':
                options.mode = parseMode(readValue(args, i, arg));
                i++;
                break;
            case '--arch':
                options.arch = parseArch(readValue(args, i, arg));
                i++;
                break;
            case '--qt-path':
                options.qtPath = readValue(args, i, arg);
                i++;
                break;
            case '--vs-dev-shell':
                options.vsDevShell = readValue(args, i, arg);
                i++;
                break;
            case '--target':
                options.target = readValue(args, i, arg);
                i++;
                break;
            case '--qmake-args':
                options.qmakeArgs = readValue(args, i, arg);
                i++;
                break;
            case '--detach':
                options.detach = true;
                break;
            case '--json':
                options.json = true;
                break;
            default:
                throw new Error(`未知参数: ${arg}`);
        }
    }

    return options;
}
