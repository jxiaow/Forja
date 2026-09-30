/**
 * 构建输出编译诊断解析 — 纯 Node.js，不依赖 vscode。
 *
 * 从 MSVC / GCC / Clang / Qt 工具链（uic/rcc/moc）的构建输出文本中提取
 * 带文件位置的诊断条目，供 VSCode Problems 面板展示。
 *
 * 过滤规则：
 * - 相对路径按 workroots 依次解析；
 * - 仅收录解析到真实存在文件的条目（过滤链接错误、工具自身噪音）；
 * - 跳过 LNK 链接器代码与 note 级提示；
 * - Qt 工具无位置信息的行式错误降级为无行号项（line = 0）。
 */
import * as fs from 'fs';
import * as path from 'path';

export type CompilerToolchain = 'msvc' | 'gcc' | 'clang';

export interface CompilerDiagnostic {
    /** 绝对路径，已通过存在性校验 */
    file: string;
    /** 1-based 行号；0 表示无行号信息（Qt 工具降级项） */
    line: number;
    /** 1-based 列号（若输出中提供） */
    column?: number;
    severity: 'error' | 'warning';
    /** 诊断代码，如 C2065 / -Wunused-variable */
    code?: string;
    /** 编译器原文消息（不做翻译，直接透传） */
    message: string;
    toolchain: CompilerToolchain;
}

// 严重级关键词（英文 + 中文本地化常见变体），长词优先避免被短词截断
const SEV = '(fatal\\s+error|致命错误|严重错误|错误|error|警告|warning|注意|note)';
// 可选的诊断代码：1-3 个字母 + 2-7 位数字（C2065 / LNK2019 / D9025 等）
const CODE = '(?:([A-Za-z]{1,3}\\d{2,7})\\s*)?';
// 半角/全角冒号（中文本地化输出可能出现全角冒号）
const COLON = '[:：]';

/** MSVC 主流格式：path\file.cpp(12): error C2065: msg，含 (12,5) 列号与空格变体 */
const MSVC_RE = new RegExp(
    `^(.+?)\\s*\\((\\d+)(?:[;,]\\s*(\\d+))?\\)\\s*${COLON}\\s*${SEV}\\s*${CODE}${COLON}\\s*(.+)$`,
    'i'
);

/** MSVC 带 "line" 关键字变体：path(file.cpp): line 12: error C2065: msg */
const MSVC_LINE_KEYWORD_RE = new RegExp(
    `^(.+?)\\(([^()]+\\.[A-Za-z]{1,5})\\)\\s*${COLON}\\s*line\\s+(\\d+)(?:\\s*[:,，]\\s*(?:col(?:umn)?\\s*)?(\\d+))?\\s*${COLON}\\s*${SEV}\\s*${CODE}${COLON}\\s*(.+)$`,
    'i'
);

/** GCC/Clang/moc 主流格式：file.cpp:12:5: error: msg（列号可选） */
const POSIX_RE = new RegExp(
    `^(.+?):(\\d+)(?::(\\d+))?\\s*${COLON}\\s*${SEV}\\s*${CODE}${COLON}\\s*(.+)$`,
    'i'
);

/** Qt 工具（uic/rcc/moc/qmake）行式错误的触发特征 */
const QT_TOOL_RE = /\b(?:uic|rcc|moc|qmake)\b|\bCannot find file\b/i;
/** Qt 工具错误行里可降级定位的文件名 token */
const QT_FILE_TOKEN_RE = /[^\s'"<>()[\]]+?\.(?:ui|qrc|qss|pro|pri|cpp|cc|cxx|c|h|hpp|hxx|idl|json)(?=[\s'".,;:)\]]|$)/i;

type Match = {
    file: string;
    line: number;
    column?: number;
    severity: 'error' | 'warning';
    code?: string;
    message: string;
    toolchain: CompilerToolchain;
};

function normalizeSeverity(word: string): 'error' | 'warning' | 'note' | null {
    const w = word.toLowerCase();
    if (w === 'note' || w === '注意') { return 'note'; }
    if (w === 'warning' || w === '警告') { return 'warning'; }
    if (w.includes('error') || w === '错误' || w === '致命错误' || w === '严重错误') { return 'error'; }
    return null;
}

/** msbuild 节点前缀（`1>`）与行首噪音清理 */
function stripNodePrefix(line: string): string {
    return line.replace(/^\s*\d+[:>]\s?/, '').replace(/^\s+/, '');
}

/** ANSI 转义序列（ESC 开头，避免在正则字面量中写控制字符） */
const ANSI_RE = new RegExp(String.fromCharCode(0x1b) + '\\[[0-9;?]*[0-9A-Za-z]', 'g');

function hasControlChars(text: string): boolean {
    for (let i = 0; i < text.length; i += 1) {
        if (text.charCodeAt(i) < 0x20) { return true; }
    }
    return false;
}

/**
 * 解析源文件路径：绝对路径直用；相对路径依次按 workroots 解析。
 * 反斜杠/正斜杠两种分隔符都尝试，保证跨平台日志可解析。
 * 仅返回真实存在的文件，其余（链接器、第三方噪音）返回 null。
 */
export function resolveDiagnosticFile(raw: string, workroots: string[]): string | null {
    let token = raw.trim().replace(/^["']+|["']+$/g, '');
    if (!token || hasControlChars(token)) { return null; }
    // 去掉尾部多余的点/冒号残留（个别本地化输出会带上）
    token = token.replace(/[.\s]+$/, '');
    const sepVariants = [token, token.replace(/\//g, path.sep), token.replace(/\\/g, '/')];
    const variants = [...new Set(sepVariants)];
    const candidates: string[] = [];
    for (const v of variants) {
        if (path.isAbsolute(v)) {
            candidates.push(v);
        } else {
            candidates.push(path.resolve(v));
            for (const root of workroots) {
                if (root) { candidates.push(path.resolve(root, v)); }
            }
        }
    }
    for (const c of candidates) {
        try {
            if (fs.existsSync(c) && fs.statSync(c).isFile()) { return path.normalize(c); }
        } catch {
            // 非法路径（如超长/保留名）：跳过该候选
        }
    }
    return null;
}

function detectGlobalToolchain(text: string): 'gcc' | 'clang' {
    return /\bclang(?:\+\+)?\b/i.test(text) ? 'clang' : 'gcc';
}

function extractFlagCode(message: string): string | undefined {
    const flag = /\[(-W[^\]]+)\]/.exec(message);
    return flag ? flag[1] : undefined;
}

function matchLine(line: string, workroots: string[], globalToolchain: 'gcc' | 'clang'): Match | null {
    // 1) MSVC 括号格式：file.cpp(12): error C2065: msg
    const msvc = MSVC_RE.exec(line);
    if (msvc) {
        const severity = normalizeSeverity(msvc[4]);
        if (!severity || severity === 'note') { return null; }
        const code = msvc[5];
        if (code && /^lnk/i.test(code)) { return null; }
        const file = resolveDiagnosticFile(msvc[1], workroots);
        if (!file) { return null; }
        const lineNo = Number(msvc[2]);
        if (!(lineNo >= 1)) { return null; }
        const column = msvc[3] ? Number(msvc[3]) : undefined;
        return { file, line: lineNo, column, severity, code, message: msvc[6].trim(), toolchain: 'msvc' };
    }

    // 2) MSVC "line 关键字" 变体：dir(file.cpp): line 12: error C2065: msg
    const msvcLine = MSVC_LINE_KEYWORD_RE.exec(line);
    if (msvcLine) {
        const severity = normalizeSeverity(msvcLine[5]);
        if (!severity || severity === 'note') { return null; }
        const code = msvcLine[6];
        if (code && /^lnk/i.test(code)) { return null; }
        const dir = msvcLine[1].trim().replace(/[\\/]+$/, '');
        const combined = dir ? `${dir}/${msvcLine[2].trim()}` : msvcLine[2].trim();
        const file = resolveDiagnosticFile(combined, workroots);
        if (!file) { return null; }
        const lineNo = Number(msvcLine[3]);
        if (!(lineNo >= 1)) { return null; }
        const column = msvcLine[4] ? Number(msvcLine[4]) : undefined;
        return { file, line: lineNo, column, severity, code, message: msvcLine[7].trim(), toolchain: 'msvc' };
    }

    // 3) GCC/Clang/moc 冒号格式：file.cpp:12:5: error|warning: msg
    const posix = POSIX_RE.exec(line);
    if (posix) {
        const severity = normalizeSeverity(posix[4]);
        if (!severity || severity === 'note') { return null; }
        const code = posix[5];
        if (code && /^lnk/i.test(code)) { return null; }
        const file = resolveDiagnosticFile(posix[1], workroots);
        if (!file) { return null; }
        const lineNo = Number(posix[2]);
        if (!(lineNo >= 1)) { return null; }
        const column = posix[3] ? Number(posix[3]) : undefined;
        const message = posix[6].trim();
        return {
            file, line: lineNo, column, severity,
            code: code ?? extractFlagCode(message),
            message, toolchain: globalToolchain
        };
    }

    // 4) Qt uic/rcc/moc 行式错误 → 降级为无行号项（line = 0）
    if (QT_TOOL_RE.test(line) && /(error|错误|cannot|failed)/i.test(line)) {
        const token = QT_FILE_TOKEN_RE.exec(line);
        if (token) {
            const file = resolveDiagnosticFile(token[0], workroots);
            if (file) {
                return { file, line: 0, severity: 'error', message: line.trim(), toolchain: globalToolchain };
            }
        }
    }

    return null;
}

/**
 * 解析构建输出文本，返回去重后的诊断列表。
 * @param outputText 构建的完整 stdout+stderr 文本
 * @param workroots 相对路径解析用的工作根目录（按优先级排列）
 */
export function parseCompilerDiagnostics(outputText: string, workroots: string[]): CompilerDiagnostic[] {
    const results: CompilerDiagnostic[] = [];
    if (!outputText) { return results; }
    const cleaned = outputText.replace(ANSI_RE, '');
    const globalToolchain = detectGlobalToolchain(cleaned);
    const seen = new Set<string>();
    for (const rawLine of cleaned.split(/\r?\n/)) {
        const line = stripNodePrefix(rawLine);
        if (!line) { continue; }
        const match = matchLine(line, workroots, globalToolchain);
        if (!match) { continue; }
        const key = `${match.file}|${match.line}|${match.column ?? 0}|${match.severity}|${match.message}`;
        if (seen.has(key)) { continue; }
        seen.add(key);
        const diagnostic: CompilerDiagnostic = {
            file: match.file,
            line: match.line,
            severity: match.severity,
            message: match.message,
            toolchain: match.toolchain
        };
        if (match.column && match.column >= 1) { diagnostic.column = match.column; }
        if (match.code) { diagnostic.code = match.code; }
        results.push(diagnostic);
    }
    return results;
}
