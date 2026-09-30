/**
 * 构建编译错误 → VSCode Problems 面板。
 *
 * DiagnosticCollection source 名为 "forja"。每轮构建通过 attachDiagnosticsMatcher
 * 往任务 problemMatchers 里追加一个函数式 PatternMatcher：终端照常流式输出，
 * matcher 逐行 tee 进本轮 buffer（不产生 match，避免与 $msCompile/$gcc 双报）。
 * 构建任务结束（无论成败）后用 buffer 全文解析编译诊断并写入 collection。
 * 点击诊断由 VSCode 原生跳行，不新增其他 UI 依赖。
 */
import * as vscode from 'vscode';
import { parseCompilerDiagnostics, CompilerDiagnostic } from '../core/compilerDiagnostics';
import { createLogger } from './logger';
import { resolveProjectRoot } from './workspaceResolver';
import { createBuildOutputTee, BuildOutputTee } from './buildOutputTee';

declare module 'vscode' {
    /** 函数式 pattern 产出的匹配结果（本模块只 tee 行，不构造该值） */
    export interface ProblemMatch {
        resource: Uri;
        [key: string]: unknown;
    }
    /** ProblemMatcher 的 pattern 形状：regexp 型或函数型二选一 */
    export interface ProblemPattern {
        regexp?: string;
        kind?: string;
        fileLocation?: string[];
        pattern?: (line: string) => ProblemMatch | ProblemMatch[] | undefined;
    }
    export interface ProblemMatcher {
        source?: string;
        label?: string;
        owner?: string;
        applyTo?: string;
        fileLocation?: string[];
        pattern: ProblemPattern | ProblemPattern[];
    }
}

const logger = createLogger('Diagnostics');

let _collection: vscode.DiagnosticCollection | null = null;

/** matcher 对象 → 本轮 tee 与调用方已知工作根；任务结束时按 matcher 回收，防泄漏 */
const _rounds = new Map<vscode.ProblemMatcher, { tee: BuildOutputTee; workroots: string[] }>();

/** 注册 collection 并挂到 context.subscriptions（由 registerCommands 调用） */
export function initBuildDiagnostics(context: vscode.ExtensionContext): void {
    context.subscriptions.push(_ensureCollection());
}

function _ensureCollection(): vscode.DiagnosticCollection {
    if (!_collection) {
        _collection = vscode.languages.createDiagnosticCollection('forja');
    }
    return _collection;
}

/**
 * 新一轮构建开始：清空 forja 诊断，返回本轮输出 tee 的 ProblemMatcher。
 * 调用方把它追加进任务原有的 problemMatchers 数组（一个 ShellExecution
 * 可传 matcher 数组），任务结束时用同一个 matcher 调用 endBuildTee。
 * @param extraWorkroots 调用方已知的构建工作根（如 projectDir），优先参与相对路径解析
 */
export function attachDiagnosticsMatcher(extraWorkroots: string[] = []): vscode.ProblemMatcher {
    _ensureCollection().clear();
    const tee = createBuildOutputTee();
    const matcher = tee.matcher as unknown as vscode.ProblemMatcher;
    _rounds.set(matcher, { tee, workroots: extraWorkroots });
    return matcher;
}

/**
 * 构建任务结束：取本轮逐行 tee 的输出全文，解析编译诊断并写入 Problems。
 * 成功与失败路径都必须调用（诊断有无由解析结果决定）。
 */
export function endBuildTee(matcher: vscode.ProblemMatcher): void {
    const round = _rounds.get(matcher);
    if (!round) { return; }
    _rounds.delete(matcher);
    const lines = round.tee.finish();
    if (!lines || lines.length === 0) { return; }
    const text = lines.join('\n');
    if (!text.trim()) { return; }
    publishBuildDiagnostics(text, round.workroots);
}

/** 任务启动失败等异常路径：仅回收本轮 buffer，不解析 */
export function discardBuildTee(matcher: vscode.ProblemMatcher): void {
    const round = _rounds.get(matcher);
    if (!round) { return; }
    _rounds.delete(matcher);
    round.tee.finish();
}

/** 解析输出文本并写入 collection，返回写入的诊断数 */
export function publishBuildDiagnostics(outputText: string, extraWorkroots: string[] = []): number {
    const workroots = _collectWorkroots(extraWorkroots);
    const items = parseCompilerDiagnostics(outputText, workroots);
    const collection = _ensureCollection();
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const item of items) {
        const list = byFile.get(item.file) || [];
        list.push(_toVscodeDiagnostic(item));
        byFile.set(item.file, list);
    }
    collection.clear();
    for (const [filePath, diagnostics] of byFile.entries()) {
        collection.set(vscode.Uri.file(filePath), diagnostics);
    }
    if (items.length > 0) {
        logger.info(`published ${items.length} build diagnostic(s) from build output`);
    }
    return items.length;
}

function _collectWorkroots(extraWorkroots: string[]): string[] {
    const roots: string[] = [];
    for (const root of extraWorkroots) { if (root) { roots.push(root); } }
    const qtRoot = resolveProjectRoot('qt');
    if (qtRoot) { roots.push(qtRoot); }
    const cppRoot = resolveProjectRoot('cpp');
    if (cppRoot) { roots.push(cppRoot); }
    for (const folder of vscode.workspace.workspaceFolders || []) {
        roots.push(folder.uri.fsPath);
    }
    return roots;
}

function _toVscodeDiagnostic(item: CompilerDiagnostic): vscode.Diagnostic {
    // Parser 使用 1-based 行号；line = 0 表示无行号信息，落在文件首行
    const zeroLine = Math.max(0, item.line - 1);
    const zeroColumn = Math.max(0, (item.column ?? 1) - 1);
    const range = new vscode.Range(zeroLine, zeroColumn, zeroLine, zeroColumn + 1);
    const severity = item.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error;
    const diagnostic = new vscode.Diagnostic(range, item.message, severity);
    if (item.code) { diagnostic.code = item.code; }
    return diagnostic;
}
