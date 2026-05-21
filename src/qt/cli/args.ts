import { CliAction, CliArch, CliBuildMode, CliOptions } from './types';

const validActions: CliAction[] = ['init', 'use', 'status', 'env', 'projects', 'qmake', 'build', 'clean', 'run', 'stop', 'sync', 'logs', 'rcc'];

const helpText = `Compilot Qt CLI — qmake 项目构建工具

用法: compilot qt <command> [options]

命令:
  init        初始化本地配置（检测环境、保存项目/构建配置）
  use         切换当前 workspace 使用的项目/构建配置
  env         查看工具链环境（检测到的 Qt/VS/jom 及可选项）
  projects    查看 workspace 下的 .pro 文件列表
  status      显示当前配置、环境和项目状态
  qmake       生成/查看 qmake 命令
  build       构建项目
  clean       清理编译产物
  run         构建并运行
  stop        停止运行中的程序
  logs        查看运行日志（--detach 模式启动后的程序输出）
  sync        同步变更文件到远程服务器（基于 git diff）
  rcc         编译 .qrc 资源文件为 .rcc 二进制

通用选项:
  --workspace <path>     工作区路径（默认当前目录）
  --json                 输出 JSON 格式（适合 AI 工具解析）
  --help, -h             显示此帮助信息

init/use 选项:
  --project <path>       指定当前 .pro 文件路径
  --mode debug|release   指定构建模式
  --arch x86|x64         指定目标架构
  --qt-path <path>       指定 Qt 安装路径
  --vs-dev-shell <path>  指定 Launch-VsDevShell.ps1 路径
  --target <name>        指定 QMake TARGET 覆盖

init 选项:
  --save-local           将检测结果写入 Compilot 本地配置

执行选项:
  --plan                 仅生成命令计划，不执行（init/use/qmake/build/run/clean/sync/rcc）
  --dry-run              （兼容旧版，等同于 --plan）
  --detach               run 成功构建后后台启动程序

sync 选项:
  --server <name>        同步时指定服务器名称
  --repo <name>          同步时指定子仓库名称（多仓库工作区）

示例:
  compilot qt init --json              初始化并保存配置
  compilot qt use --mode release       切换到 release 配置
  compilot qt build                    执行构建
  compilot qt build --plan             查看构建命令（不执行）
  compilot qt run --detach             后台构建并运行
  compilot qt sync                     同步变更文件到远程
  compilot qt status                   查看当前状态
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
    '--dry-run',
    '--workspace',
    '--project',
    '--mode',
    '--arch',
    '--qt-path',
    '--vs-dev-shell',
    '--target',
    '--server',
    '--repo',
    '--save-local',
    '--detach',
    '--json'
]);

const commonFlags = ['--workspace', '--json'];
const configFlags = ['--project', '--mode', '--arch', '--qt-path', '--vs-dev-shell', '--target'];
const planFlags = ['--plan', '--dry-run'];
const actionAllowedFlags: Record<CliAction, Set<string>> = {
    init: new Set([...commonFlags, ...planFlags, ...configFlags, '--save-local']),
    use: new Set([...commonFlags, ...planFlags, ...configFlags]),
    status: new Set(commonFlags),
    env: new Set(commonFlags),
    projects: new Set(commonFlags),
    qmake: new Set([...commonFlags, ...planFlags]),
    build: new Set([...commonFlags, ...planFlags]),
    clean: new Set([...commonFlags, ...planFlags]),
    run: new Set([...commonFlags, ...planFlags, '--detach']),
    stop: new Set(commonFlags),
    sync: new Set([...commonFlags, ...planFlags, '--server', '--repo']),
    logs: new Set(commonFlags),
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
        server: null,
        repo: null,
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
            case '--dry-run':
                // 兼容旧版，等同于 --plan
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
            case '--server':
                options.server = readValue(args, i, arg);
                i++;
                break;
            case '--repo':
                options.repo = readValue(args, i, arg);
                i++;
                break;
            case '--save-local':
                options.saveLocal = true;
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
