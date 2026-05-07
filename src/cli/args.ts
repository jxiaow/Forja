import { CliAction, CliArch, CliBuildMode, CliOptions } from './types';

const validActions: CliAction[] = ['init', 'detect', 'projects', 'status', 'qmake', 'build', 'run', 'stop'];

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
        executionMode: 'dryRun',
        workspace: null,
        project: null,
        mode: null,
        arch: null,
        qtPath: null,
        vsDevShell: null,
        target: null,
        saveLocal: false,
        json: false
    };

    let sawDryRun = false;
    let sawExecute = false;

    const startIndex = actionText === firstArg ? 1 : 0;

    for (let i = startIndex; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
            case '--execute':
                sawExecute = true;
                options.executionMode = 'execute';
                break;
            case '--dry-run':
                sawDryRun = true;
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
            case '--save-local':
                options.saveLocal = true;
                break;
            case '--json':
                options.json = true;
                break;
            default:
                throw new Error(`未知参数: ${arg}`);
        }

        if (sawDryRun && sawExecute) {
            throw new Error('不能同时使用 --dry-run 和 --execute');
        }
    }

    return options;
}
