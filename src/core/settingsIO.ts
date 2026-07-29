/**
 * 统一配置文件读写 — 不依赖 vscode，可独立测试。
 *
 * 配置存储在用户数据目录 ~/.compilot/projects/ 下，
 * 文件名为 workspace 路径的 hash，内容平铺不加前缀分组。
 *
 * 每个 workspace 目录对应一个配置文件，只存一种配置（qt 或 sdk 或 sync）。
 * 配置类型通过文件内的 `type` 字段区分。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

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
    remotePaths: Record<string, string>;
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
    remotePaths: {},
    ignore: ['.git', 'node_modules', 'out', '.compilot', 'build', 'debug', 'release']
};

export const DEFAULT_SETTINGS: Readonly<CompilotSettings> = {
    qt: DEFAULT_QT,
    sdk: DEFAULT_SDK,
    sync: DEFAULT_SYNC
};

// ── 路径 ──

/** 用户数据目录下的 projects 配置目录 */
export function projectsDir(): string {
    return path.join(os.homedir(), '.compilot', 'projects');
}

/** 根据 workspace 路径和配置类型生成配置文件路径 */
export function projectConfigPath(workspace: string, type: 'qt' | 'sdk' | 'sync'): string {
    const normalized = workspace.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const hash = crypto.createHash('sha256').update(`${normalized}:${type}`).digest('hex').slice(0, 12);
    return path.join(projectsDir(), `${hash}.json`);
}

// ── Qt 配置读写 ──

export function loadQtSettings(workspace: string): QtSettings {
    const filePath = projectConfigPath(workspace, 'qt');
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return sanitizeQt(raw);
        }
    } catch { /* file missing or malformed */ }
    return { ...DEFAULT_QT };
}

export function saveQtSettings(workspace: string, settings: QtSettings): void {
    const filePath = projectConfigPath(workspace, 'qt');
    _ensureDir(filePath);
    const data: Record<string, unknown> = {
        workspace,
        type: 'qt',
        ...settings
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n', 'utf8');
}

// ── SDK 配置读写 ──

export function loadSdkSettings(workspace: string): SdkSettings {
    const filePath = projectConfigPath(workspace, 'sdk');
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return sanitizeSdk(raw);
        }
    } catch { /* file missing or malformed */ }
    return { ...DEFAULT_SDK };
}

export function saveSdkSettings(workspace: string, settings: SdkSettings): void {
    const filePath = projectConfigPath(workspace, 'sdk');
    _ensureDir(filePath);
    const data: Record<string, unknown> = {
        workspace,
        type: 'sdk',
        ...settings
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n', 'utf8');
}

// ── Sync 配置读写 ──

/**
 * 加载 sync 配置。向上一级查找：如果当前 workspace 没有 sync 配置，
 * 尝试父目录。
 */
export function loadSyncSettings(workspace: string): SyncSettings {
    // 先找当前 workspace
    const filePath = projectConfigPath(workspace, 'sync');
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return sanitizeSync(raw);
        }
    } catch { /* file missing or malformed */ }

    // 向上一级查找（monorepo 场景：子项目继承父目录的 sync 配置）
    const parent = path.dirname(workspace);
    if (parent !== workspace) {
        const parentPath = projectConfigPath(parent, 'sync');
        try {
            if (fs.existsSync(parentPath)) {
                const raw = JSON.parse(fs.readFileSync(parentPath, 'utf8'));
                return sanitizeSync(raw);
            }
        } catch { /* file missing or malformed */ }
    }

    return { ...DEFAULT_SYNC };
}

export function saveSyncSettings(workspace: string, settings: SyncSettings): void {
    const filePath = projectConfigPath(workspace, 'sync');
    _ensureDir(filePath);
    const data: Record<string, unknown> = {
        workspace,
        type: 'sync',
        ...settings
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n', 'utf8');
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
    const normalized = vsPath.replace(/\\/g, '/');
    const match = normalized.match(/^(.+?)\/Common7\/Tools\//i);
    return match ? match[1].replace(/\//g, path.sep) : '';
}

// ── 工具函数 ──

/** 列出所有项目配置文件（用于 cleanup 命令） */
export function listProjectConfigs(): Array<{ filePath: string; workspace: string; type: string }> {
    const dir = projectsDir();
    if (!fs.existsSync(dir)) { return []; }
    const results: Array<{ filePath: string; workspace: string; type: string }> = [];
    try {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        for (const file of files) {
            const filePath = path.join(dir, file);
            try {
                const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (raw.workspace && raw.type) {
                    results.push({ filePath, workspace: raw.workspace, type: raw.type });
                }
            } catch { /* skip malformed */ }
        }
    } catch { /* dir read failure */ }
    return results;
}

// ── 内部工具 ──

function _ensureDir(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function isString(v: unknown): v is string { return typeof v === 'string'; }
function isBool(v: unknown): v is boolean { return typeof v === 'boolean'; }
function isStringArray(v: unknown): v is string[] { return Array.isArray(v) && v.every(i => typeof i === 'string'); }
function isNumber(v: unknown): v is number { return typeof v === 'number'; }

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
    const remotePaths: Record<string, string> = {};
    if (raw.remotePaths && typeof raw.remotePaths === 'object' && !Array.isArray(raw.remotePaths)) {
        const rp = raw.remotePaths as Record<string, unknown>;
        for (const [k, v] of Object.entries(rp)) {
            if (isString(v)) { remotePaths[k] = v; }
        }
    }
    return {
        enabled: isBool(raw.enabled) ? raw.enabled : d.enabled,
        selectedServer: isString(raw.selectedServer) ? raw.selectedServer : d.selectedServer,
        remotePaths,
        ignore: isStringArray(raw.ignore) ? raw.ignore : [...d.ignore]
    };
}


