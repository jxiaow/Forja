/**
 * 构建输出逐行 tee — 纯数据结构，不依赖 vscode（可被 node 单测直接引用）。
 *
 * VSCode 的 ProblemMatcher 支持函数式 pattern：任务执行时终端照常流式输出，
 * pattern 函数会逐行收到每一行输出。这里用它的函数 pattern 做「逐行 tee」：
 * 只把行缓存进 buffer，并返回 undefined 不产生任何 match——本轮 Problems
 * 完全由 vscode 侧 diagnostics 解析器写入 DiagnosticCollection，
 * 避免与现有 $msCompile/$gcc matcher 双报。
 */

/** 函数型 ProblemMatcher 的最小形状（在 vscode 侧结构与 vscode.ProblemMatcher 对齐） */
export interface TeeProblemMatch {
    resource: { fsPath: string };
    [key: string]: unknown;
}

export interface TeeMatcher {
    source?: string;
    label?: string;
    pattern: {
        pattern: (line: string) => TeeProblemMatch | TeeProblemMatch[] | undefined;
    };
}

export interface BuildOutputTee {
    readonly matcher: TeeMatcher;
    /** 收走本轮输出行并注销注册；已收走过则返回 undefined */
    finish(): string[] | undefined;
}

/** 单个 tee 的行数上限，防止极端超长构建输出下 buffer 无界增长 */
const MAX_LINES = 100_000;
/** 同时活跃的 tee 上限，防止任务结束事件未达时泄漏 */
const MAX_ACTIVE_TEES = 16;

const _active = new Map<TeeMatcher, string[]>();
let _seq = 0;

/** 创建一次构建输出的 tee；matcher 直接追加进 ShellExecution 的 problemMatchers 数组 */
export function createBuildOutputTee(): BuildOutputTee {
    if (_active.size >= MAX_ACTIVE_TEES) {
        const oldest = _active.keys().next().value;
        if (oldest !== undefined) { _active.delete(oldest); }
    }
    const lines: string[] = [];
    const matcher: TeeMatcher = {
        source: `forja-build-tee-${++_seq}`,
        label: 'Forja build output tee',
        pattern: {
            pattern: (line: string) => {
                if (lines.length < MAX_LINES) { lines.push(line); }
                return undefined;
            }
        }
    };
    _active.set(matcher, lines);
    return {
        matcher,
        finish(): string[] | undefined {
            if (!_active.has(matcher)) { return undefined; }
            _active.delete(matcher);
            return lines;
        }
    };
}

/** 当前活跃 tee 数量（测试与诊断用） */
export function activeTeeCount(): number {
    return _active.size;
}
