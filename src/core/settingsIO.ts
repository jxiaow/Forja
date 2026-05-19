/**
 * 统一配置文件读写 — 不依赖 vscode，可独立测试。
 *
 * 单文件结构：.compilot/settings.json
 * 顶层分组：qt / sdk / sync
 */
import * as fs from 'fs';
import * as path from 'path';

// ── 类型定义 ──

export interface QtSettings {
    mode: 'debug' | 'release' | '';
    arch: 'x86' | 'x64' | '';
    vsInstall: string;
    qtPath: string;
    jomPath: string;
    pinnedProject: { root: string; relative: string } | null;
    target: string;
    cStandard: string;
    cppStandard: string;
    designerPath: string;
    qtSourcePath: string;
    manualProPath: string;
    rccProjectPath: string;
    scanExcludeDirs: string[];
    customCommands: { name: string; command: string }[];
    fileSyncPromptEnabled: boolean;
    qmakeReminderEnabled: boolean;
}

export interface SdkSettings {
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    vsInstall: string;
    pinnedProject: string | null;
    scanDepth?: number;
}

export interface SyncSettings {
    enabled: boolean;
    selectedServer: string;
    remotePath: string;
    ignore: string[];
}

export interface CompilotSettings {
    qt: QtSettings;
    sdk: SdkSettings;
    sync: SyncSettings;
}

// ── 默认值 ──

export const DEFAULT_QT: Readonly<QtSettings> = {
    mode: '',
    arch: '',
    vsInstall: '',
    qtPath: '',
    jomPath: '',
    pinnedProject: null,
    target: '',
    cStandard: 'c11',
    cppStandard: 'c++11',
    designerPath: '',
    qtSourcePath: '',
    manualProPath: '',
    rccProjectPath: '',
    scanExcludeDirs: [],
    customCommands: [],
    fileSyncPromptEnabled: true,
    qmakeReminderEnabled: true
};

export const DEFAULT_SDK: Readonly<SdkSettings> = {
    mode: 'debug',
    arch: 'x86',
    vsInstall: '',
    pinnedProject: null
};

export const DEFAULT_SYNC: Readonly<SyncSettings> = {
    enabled: false,
    selectedServer: '',
    remotePath: '',
    ignore: ['.git', 'node_modules', 'out', '.compilot', 'build', 'debug', 'release']
};

export const DEFAULT_SETTINGS: Readonly<CompilotSettings> = {
    qt: DEFAULT_QT,
    sdk: DEFAULT_SDK,
    sync: DEFAULT_SYNC
};

// ── 路径 ──

export function settingsFilePath(workspace: string): string {
    return path.join(workspace, '.compilot', 'settings.json');
}

// ── 加载 ──

export function loadSettings(workspace: string): CompilotSettings {
    const filePath = settingsFilePath(workspace);
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return sanitizeSettings(raw);
        }
    } catch { /* file missing or malformed */ }
    return { qt: { ...DEFAULT_QT }, sdk: { ...DEFAULT_SDK }, sync: { ...DEFAULT_SYNC } };
}

// ── 保存 ──

export function saveSettings(workspace: string, settings: CompilotSettings): void {
    try {
        const filePath = settingsFilePath(workspace);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(settings, null, 4) + '\n', 'utf8');
    } catch (e) {
        console.warn(`[compilot] saveSettings 失败: ${e instanceof Error ? e.message : e}`);
    }
}

// ── VS 路径推导 ──

export function resolveVsDevShellPath(vsInstall: string): string {
    if (!vsInstall) { return ''; }
    return path.join(vsInstall, 'Common7', 'Tools', 'Launch-VsDevShell.ps1');
}

export function resolveVsDevCmdPath(vsInstall: string): string {
    if (!vsInstall) { return ''; }
    return path.join(vsInstall, 'Common7', 'Tools', 'VsDevCmd.bat');
}

/** 从 vsDevShellPath 或 vsDevCmdPath 反推 vsInstall 路径 */
export function inferVsInstall(vsPath: string): string {
    if (!vsPath) { return ''; }
    // 路径格式: {vsInstall}/Common7/Tools/Launch-VsDevShell.ps1 或 VsDevCmd.bat
    const normalized = vsPath.replace(/\\/g, '/');
    const match = normalized.match(/^(.+?)\/Common7\/Tools\//i);
    return match ? match[1].replace(/\//g, path.sep) : '';
}

// ── 内部工具 ──

function isString(v: unknown): v is string { return typeof v === 'string'; }
function isBool(v: unknown): v is boolean { return typeof v === 'boolean'; }
function isStringArray(v: unknown): v is string[] { return Array.isArray(v) && v.every(i => typeof i === 'string'); }
function isNumber(v: unknown): v is number { return typeof v === 'number'; }

function sanitizeSettings(raw: Record<string, unknown>): CompilotSettings {
    const qtRaw = (raw.qt && typeof raw.qt === 'object') ? raw.qt as Record<string, unknown> : {};
    const sdkRaw = (raw.sdk && typeof raw.sdk === 'object') ? raw.sdk as Record<string, unknown> : {};
    const syncRaw = (raw.sync && typeof raw.sync === 'object') ? raw.sync as Record<string, unknown> : {};

    return {
        qt: sanitizeQt(qtRaw),
        sdk: sanitizeSdk(sdkRaw),
        sync: sanitizeSync(syncRaw)
    };
}

function sanitizeQt(raw: Record<string, unknown>): QtSettings {
    const d = DEFAULT_QT;

    let pinnedProject: QtSettings['pinnedProject'] = null;
    if (raw.pinnedProject && typeof raw.pinnedProject === 'object') {
        const p = raw.pinnedProject as Record<string, unknown>;
        if (isString(p.root) && isString(p.relative)) {
            pinnedProject = { root: p.root, relative: p.relative };
        }
    }

    let customCommands: QtSettings['customCommands'] = [];
    if (Array.isArray(raw.customCommands)) {
        customCommands = raw.customCommands.filter(
            (c: unknown) => !!c && typeof c === 'object' && isString((c as Record<string, unknown>).name) && isString((c as Record<string, unknown>).command)
        ) as QtSettings['customCommands'];
    }

    return {
        mode: (raw.mode === 'debug' || raw.mode === 'release' || raw.mode === '') ? raw.mode : d.mode,
        arch: (raw.arch === 'x86' || raw.arch === 'x64' || raw.arch === '') ? raw.arch : d.arch,
        vsInstall: isString(raw.vsInstall) ? raw.vsInstall : d.vsInstall,
        qtPath: isString(raw.qtPath) ? raw.qtPath : d.qtPath,
        jomPath: isString(raw.jomPath) ? raw.jomPath : d.jomPath,
        pinnedProject,
        target: isString(raw.target) ? raw.target : d.target,
        cStandard: isString(raw.cStandard) ? raw.cStandard : d.cStandard,
        cppStandard: isString(raw.cppStandard) ? raw.cppStandard : d.cppStandard,
        designerPath: isString(raw.designerPath) ? raw.designerPath : d.designerPath,
        qtSourcePath: isString(raw.qtSourcePath) ? raw.qtSourcePath : d.qtSourcePath,
        manualProPath: isString(raw.manualProPath) ? raw.manualProPath : d.manualProPath,
        rccProjectPath: isString(raw.rccProjectPath) ? raw.rccProjectPath : d.rccProjectPath,
        scanExcludeDirs: isStringArray(raw.scanExcludeDirs) ? raw.scanExcludeDirs : d.scanExcludeDirs,
        customCommands,
        fileSyncPromptEnabled: isBool(raw.fileSyncPromptEnabled) ? raw.fileSyncPromptEnabled : d.fileSyncPromptEnabled,
        qmakeReminderEnabled: isBool(raw.qmakeReminderEnabled) ? raw.qmakeReminderEnabled : d.qmakeReminderEnabled
    };
}

function sanitizeSdk(raw: Record<string, unknown>): SdkSettings {
    const d = DEFAULT_SDK;
    return {
        mode: (raw.mode === 'debug' || raw.mode === 'release') ? raw.mode : d.mode,
        arch: (raw.arch === 'x86' || raw.arch === 'x64') ? raw.arch : d.arch,
        vsInstall: isString(raw.vsInstall) ? raw.vsInstall : d.vsInstall,
        pinnedProject: isString(raw.pinnedProject) ? raw.pinnedProject : null,
        ...(isNumber(raw.scanDepth) && raw.scanDepth >= 1 ? { scanDepth: raw.scanDepth } : {})
    };
}

function sanitizeSync(raw: Record<string, unknown>): SyncSettings {
    const d = DEFAULT_SYNC;
    return {
        enabled: isBool(raw.enabled) ? raw.enabled : d.enabled,
        selectedServer: isString(raw.selectedServer) ? raw.selectedServer : d.selectedServer,
        remotePath: isString(raw.remotePath) ? raw.remotePath : d.remotePath,
        ignore: isStringArray(raw.ignore) ? raw.ignore : [...d.ignore]
    };
}

// ── 兼容旧接口（过渡期，逐步移除） ──

/** @deprecated 使用 loadSettings(workspace).qt 替代 */
export type QtPilotSettings = QtSettings;
/** @deprecated 使用 DEFAULT_SETTINGS.qt 替代 */
export { DEFAULT_QT as LEGACY_DEFAULT_SETTINGS };
