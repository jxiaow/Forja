import { CliAction, CliArch, CliBuildMode, CliOptions } from './types';

const validActions: CliAction[] = ['init', 'status', 'env', 'projects', 'qmake', 'build', 'clean', 'run', 'stop', 'sync', 'logs', 'rcc'];

const helpText = `Compilot Qt CLI — qmake 项目构建工具

用法: compilot qt <command> [options]

命令:
  init        初始化本地配置（检测环境、保存 .compilot/）
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

选项:
  --workspace <path>     工作区路径（默认当前目录）
  --project <path>       指定 .pro 文件路径
  --mode debug|release   构建模式（默认 debug）
  --arch x86|x64         目标架构（默认 x86）
  --qt-path <path>       Qt 安装路径
  --vs-dev-shell <path>  Launch-VsDevShell.ps1 路径
  --target <name>        QMake TARGET 覆盖
  --server <name>        同步时指定服务器名称
  --repo <name>          同步时指定子仓库名称（多仓库工作区）
  --plan                 仅生成命令计划，不执行
  --dry-run              （兼容旧版，等同于 --plan）
  --detach               后台执行，日志落文件，CLI 立即返回
  --save-local           将检测结果写入 Compilot 本地配置
  --json                 输出 JSON 格式（适合 AI 工具解析）
  --help, -h             显示此帮助信息

示例:
  compilot qt build --json             执行构建
  compilot qt build --plan --json      查看构建命令（不执行）
  compilot qt run --detach --json      后台构建并运行
  compilot qt sync --json              同步变更文件到远程
  compilot qt status --json            查看当前状态
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
