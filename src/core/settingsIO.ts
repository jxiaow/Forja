/**
 * 统一配置文件读写 — 不依赖 vscode，可独立测试。
 *
 * 配置存储在用户数据目录 ~/.forja/projects/ 下，
 * 文件名为 workspace 路径的 hash，内容平铺不加前缀分组。
 *
 * 每个 workspace 目录对应一个配置文件，只存一种配置（qt 或 cpp 或 sync）。
 * 配置类型通过文件内的 `type` 字段区分。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { warn } from './loggerBase';

// ── 类型定义 ──

export interface QtSettings {
    mode: 'debug' | 'release' | '';
    arch: 'x86' | 'x64' | '';
    vsInstall: string;
    qtPath: string;
    qtVersion: string;
    jomPath: string;
    pinnedProject: { root: string; relative: string } | null;
    target: string;
    qmakeArgs: string;
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
    suppressedWarnings?: string[];
}

export interface CppSettings {
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    vsInstall: string;
    pinnedProject: string | null;
    scanDepth?: number;
}

export interface SyncSettings {
    enabled: boolean;
    ignore: string[];
}

export interface RemoteBuildOrderItem {
    target: 'qt' | 'cpp';
    action: 'build' | 'rebuild' | 'clean' | 'qmake';
    args: string[];
}

export interface RemoteTransferSettings {
    deployServer: string;
    deployPath: string;
    artifacts: string[];
}

export interface RemoteRepoAssetSettings {
    localPath: string;
    remotePath?: string;
}

export interface RemoteRepoSettings {
    localName: string;
    remoteName: string;
    role: 'primary' | 'mapped' | 'remote-only' | 'existing-remote' | 'skip';
    remotePath?: string;
    baseline?: 'auto' | 'status-only';
    overlay?: boolean;
    mount?: 'symlink';
    assets?: RemoteRepoAssetSettings[];
}

export interface RemoteSettings {
    remoteForjaBin: string;
    buildOrder: RemoteBuildOrderItem[];
    transfer: RemoteTransferSettings | null;
    workspaceMode: 'legacy' | 'staged';
    profile: string;
    remoteWorkspace: string;
    repos: RemoteRepoSettings[];
    // Remote execution target (separate from sync)
    selectedServer: string;
    remotePaths: Record<string, string>;
}

export interface ForjaSettings {
    qt: QtSettings;
    cpp: CppSettings;
    sync: SyncSettings;
    remote: RemoteSettings;
}

// ── 默认值 ──

export const DEFAULT_QT: Readonly<QtSettings> = {
    mode: '',
    arch: '',
    vsInstall: '',
    qtPath: '',
    qtVersion: '',
    jomPath: '',
    pinnedProject: null,
    target: '',
    qmakeArgs: '',
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

export const DEFAULT_CPP: Readonly<CppSettings> = {
    mode: 'debug',
    arch: 'x86',
    vsInstall: '',
    pinnedProject: null
};

export const DEFAULT_SYNC: Readonly<SyncSettings> = {
    enabled: false,
    ignore: ['.git', 'node_modules', 'out', '.forja', 'build', 'debug', 'release']
};

export const DEFAULT_REMOTE: Readonly<RemoteSettings> = {
    remoteForjaBin: '',
    buildOrder: [],
    transfer: null,
    workspaceMode: 'legacy',
    profile: '',
    remoteWorkspace: '',
    repos: [],
    selectedServer: '',
    remotePaths: {}
};

export const DEFAULT_SETTINGS: Readonly<ForjaSettings> = {
    qt: DEFAULT_QT,
    cpp: DEFAULT_CPP,
    sync: DEFAULT_SYNC,
    remote: DEFAULT_REMOTE
};

// ── 路径 ──

/** 用户数据目录下的 projects 配置目录 */
export function forjaConfigDir(): string {
    return process.env.FORJA_CONFIG_DIR || path.join(os.homedir(), '.forja');
}

export function projectsDir(): string {
    return path.join(forjaConfigDir(), 'projects');
}

// ── 全局配置 ──

export interface GlobalConfig {
    lang: string;
}

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = { lang: '' };

export function globalConfigPath(): string {
    return path.join(forjaConfigDir(), 'config.json');
}

export function loadGlobalConfig(): GlobalConfig {
    const filePath = globalConfigPath();
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return { lang: typeof raw.lang === 'string' ? raw.lang : '' };
        }
    } catch {
        // ignore
    }
    return { ...DEFAULT_GLOBAL_CONFIG };
}

export function saveGlobalConfig(config: Partial<GlobalConfig>): void {
    const current = loadGlobalConfig();
    const merged = { ...current, ...config };
    const dir = forjaConfigDir();
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    fs.writeFileSync(globalConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
}

/** 根据 workspace 路径和配置类型生成配置文件路径 */
export type ConfigType = 'qt' | 'cpp' | 'sync' | 'remote' | 'activeTarget' | 'targetToolchains';

export function projectConfigPath(workspace: string, type: ConfigType): string {
    const normalized = workspace.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const hash = crypto.createHash('sha256').update(`${normalized}:${type}`).digest('hex').slice(0, 12);
    return path.join(projectsDir(), `${hash}.json`);
}

/**
 * 从当前 workspace 开始向上查找存在的配置文件。
 * 子目录没有自己的配置时，自动继承父目录的。
 * 返回找到的第一个配置文件路径，没找到则返回当前 workspace 路径（用于新建）。
 */
export function resolveConfigPath(workspace: string, type: ConfigType): string {
    let current = workspace;
    for (;;) {
        const filePath = projectConfigPath(current, type);
        if (fs.existsSync(filePath)) { return filePath; }
        const parent = path.dirname(current);
        if (parent === current) { break; }
        current = parent;
    }
    if (type === 'qt') {
        const descendant = resolveUniqueDescendantConfigPath(workspace, type);
        if (descendant) { return descendant; }
    }
    return projectConfigPath(workspace, type);
}

function isDescendantWorkspace(parentWorkspace: string, childWorkspace: string): boolean {
    const parent = path.resolve(parentWorkspace);
    const child = path.resolve(childWorkspace);
    const relative = path.relative(parent, child);
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveUniqueDescendantConfigPath(workspace: string, type: 'qt' | 'cpp' | 'sync'): string | null {
    const matches = listProjectConfigs()
        .filter(config => config.type === type && isDescendantWorkspace(workspace, config.workspace));
    return matches.length === 1 ? matches[0].filePath : null;
}

// ── Corruption tracking ──

export interface CorruptedConfig { path: string; detail: string }

const _corruptedConfigs: CorruptedConfig[] = [];

export function getCorruptedConfigs(): CorruptedConfig[] {
    return [..._corruptedConfigs];
}

export function clearCorruptedConfigs(): void {
    _corruptedConfigs.length = 0;
}

// ── Qt 配置读写 ──

export function loadQtSettings(workspace: string): QtSettings {
    const filePath = resolveConfigPath(workspace, 'qt');
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return sanitizeQt(raw);
        }
    } catch (e) {
        if (e instanceof SyntaxError) { _corruptedConfigs.push({ path: filePath, detail: e.message }); }
        warnSettingsLoadFailure('qt', filePath, e);
    }
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

// ── C++ 配置读写 ──

export function loadCppSettings(workspace: string): CppSettings {
    const filePath = resolveConfigPath(workspace, 'cpp');
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return sanitizeCpp(raw);
        }
    } catch (e) {
        if (e instanceof SyntaxError) { _corruptedConfigs.push({ path: filePath, detail: e.message }); }
        warnSettingsLoadFailure('cpp', filePath, e);
    }
    return { ...DEFAULT_CPP };
}

export function saveCppSettings(workspace: string, settings: CppSettings): void {
    const filePath = projectConfigPath(workspace, 'cpp');
    _ensureDir(filePath);
    const data: Record<string, unknown> = {
        workspace,
        type: 'cpp',
        ...settings
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4) + '\n', 'utf8');
}

// ── Sync 配置读写 ──

/**
 * 加载 sync 配置（自动向上查找父目录）。
 */
export function loadSyncSettings(workspace: string): SyncSettings {
    const filePath = resolveConfigPath(workspace, 'sync');
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return sanitizeSync(raw);
        }
    } catch (e) {
        if (e instanceof SyntaxError) { _corruptedConfigs.push({ path: filePath, detail: e.message }); }
        warnSettingsLoadFailure('sync', filePath, e);
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

// ── Remote 配置读写 ──

export function loadRemoteSettings(workspace: string): RemoteSettings {
    const filePath = resolveConfigPath(workspace, 'remote');
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return sanitizeRemote(raw);
        }
    } catch (e) {
        if (e instanceof SyntaxError) { _corruptedConfigs.push({ path: filePath, detail: e.message }); }
        warnSettingsLoadFailure('remote', filePath, e);
    }
    return { ...DEFAULT_REMOTE };
}

export function saveRemoteSettings(workspace: string, settings: RemoteSettings): void {
    const filePath = projectConfigPath(workspace, 'remote');
    _ensureDir(filePath);
    const data: Record<string, unknown> = {
        workspace,
        type: 'remote',
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
            } catch (e) {
                warn(`项目配置扫描跳过损坏文件: ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
            }
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

function warnSettingsLoadFailure(type: ConfigType, filePath: string, e: unknown): void {
    warn(`${type} 配置读取失败 (invalid JSON or read error): ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
}

function isString(v: unknown): v is string { return typeof v === 'string'; }

function sanitizeStringRecord(v: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, val] of Object.entries(v)) {
        if (typeof val === 'string') { result[k] = val; }
    }
    return result;
}
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
        qtVersion: isString(raw.qtVersion) ? raw.qtVersion : d.qtVersion,
        jomPath: isString(raw.jomPath) ? raw.jomPath : d.jomPath,
        pinnedProject,
        target: isString(raw.target) ? raw.target : d.target,
        qmakeArgs: isString(raw.qmakeArgs) ? raw.qmakeArgs : d.qmakeArgs,
        cStandard: isString(raw.cStandard) ? raw.cStandard : d.cStandard,
        cppStandard: isString(raw.cppStandard) ? raw.cppStandard : d.cppStandard,
        designerPath: isString(raw.designerPath) ? raw.designerPath : d.designerPath,
        qtSourcePath: isString(raw.qtSourcePath) ? raw.qtSourcePath : d.qtSourcePath,
        manualProPath: isString(raw.manualProPath) ? raw.manualProPath : d.manualProPath,
        rccProjectPath: isString(raw.rccProjectPath) ? raw.rccProjectPath : d.rccProjectPath,
        scanExcludeDirs: isStringArray(raw.scanExcludeDirs) ? raw.scanExcludeDirs : d.scanExcludeDirs,
        customCommands,
        fileSyncPromptEnabled: isBool(raw.fileSyncPromptEnabled) ? raw.fileSyncPromptEnabled : d.fileSyncPromptEnabled,
        qmakeReminderEnabled: isBool(raw.qmakeReminderEnabled) ? raw.qmakeReminderEnabled : d.qmakeReminderEnabled,
        suppressedWarnings: isStringArray(raw.suppressedWarnings) ? raw.suppressedWarnings : undefined
    };
}
function sanitizeCpp(raw: Record<string, unknown>): CppSettings {
    const d = DEFAULT_CPP;
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
        ignore: isStringArray(raw.ignore) ? raw.ignore : [...d.ignore]
    };
}

function sanitizeRemote(raw: Record<string, unknown>): RemoteSettings {
    const d = DEFAULT_REMOTE;
    const buildOrder: RemoteBuildOrderItem[] = [];
    if (Array.isArray(raw.buildOrder)) {
        for (const item of raw.buildOrder) {
            if (!item || typeof item !== 'object') { continue; }
            const entry = item as Record<string, unknown>;
            const target = entry.target;
            const action = entry.action;
            if ((target !== 'qt' && target !== 'cpp') || !isRemoteBuildOrderAction(target, action)) { continue; }
            buildOrder.push({
                target,
                action,
                args: isStringArray(entry.args) ? entry.args : []
            });
        }
    }

    let transfer: RemoteTransferSettings | null = null;
    if (raw.transfer && typeof raw.transfer === 'object') {
        const entry = raw.transfer as Record<string, unknown>;
        if (isString(entry.deployServer) && isString(entry.deployPath) && isStringArray(entry.artifacts)) {
            transfer = {
                deployServer: entry.deployServer,
                deployPath: entry.deployPath,
                artifacts: entry.artifacts
            };
        }
    }

    const repos: RemoteRepoSettings[] = [];
    if (Array.isArray(raw.repos)) {
        for (const item of raw.repos) {
            if (!item || typeof item !== 'object') { continue; }
            const entry = item as Record<string, unknown>;
            if (!isString(entry.localName) || !isString(entry.remoteName) || !isRemoteRepoRole(entry.role)) { continue; }
            const repo: RemoteRepoSettings = {
                localName: entry.localName,
                remoteName: entry.remoteName,
                role: entry.role
            };
            if (isString(entry.remotePath)) { repo.remotePath = entry.remotePath; }
            if (entry.baseline === 'auto' || entry.baseline === 'status-only') { repo.baseline = entry.baseline; }
            if (isBool(entry.overlay)) { repo.overlay = entry.overlay; }
            if (entry.mount === 'symlink') { repo.mount = entry.mount; }
            const assets = sanitizeRemoteRepoAssets(entry.assets);
            if (assets.length > 0) { repo.assets = assets; }
            repos.push(repo);
        }
    }

    return {
        remoteForjaBin: isString(raw.remoteForjaBin) ? raw.remoteForjaBin : d.remoteForjaBin,
        buildOrder,
        transfer,
        workspaceMode: raw.workspaceMode === 'staged' || raw.workspaceMode === 'managed' ? 'staged' : d.workspaceMode,
        profile: isString(raw.profile) ? raw.profile : d.profile,
        remoteWorkspace: isString(raw.remoteWorkspace) ? raw.remoteWorkspace : d.remoteWorkspace,
        repos,
        selectedServer: isString(raw.selectedServer) ? raw.selectedServer : d.selectedServer,
        remotePaths: (raw.remotePaths && typeof raw.remotePaths === 'object' && !Array.isArray(raw.remotePaths))
            ? sanitizeStringRecord(raw.remotePaths as Record<string, unknown>)
            : d.remotePaths
    };
}

function sanitizeRemoteRepoAssets(raw: unknown): RemoteRepoAssetSettings[] {
    if (!Array.isArray(raw)) { return []; }
    const assets: RemoteRepoAssetSettings[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') { continue; }
        const entry = item as Record<string, unknown>;
        if (!isString(entry.localPath)) { continue; }
        const asset: RemoteRepoAssetSettings = { localPath: entry.localPath };
        if (isString(entry.remotePath) && entry.remotePath) { asset.remotePath = entry.remotePath; }
        assets.push(asset);
    }
    return assets;
}

function isRemoteBuildOrderAction(target: 'qt' | 'cpp', action: unknown): action is RemoteBuildOrderItem['action'] {
    if (target === 'qt') {
        return action === 'build' || action === 'clean' || action === 'qmake';
    }
    return action === 'build' || action === 'rebuild' || action === 'clean';
}

function isRemoteRepoRole(value: unknown): value is RemoteRepoSettings['role'] {
    return value === 'primary'
        || value === 'mapped'
        || value === 'remote-only'
        || value === 'existing-remote'
        || value === 'skip';
}
