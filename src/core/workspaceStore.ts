/**
 * Workspace store — workroot-based target and config management.
 *
 * Storage layout:
 *   ~/.forja/workspaces.json          — registry of workroot paths
 *   ~/.forja/workspaces/<hash>.json   — per-workspace target data + module prefs
 *
 * No vscode dependency.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { forjaConfigDir } from './settingsIO';

// ── Types ──

export interface ToolchainConfig {
    qtPath?: string;
    qtVersion?: string;
    vsInstall?: string;
    jomPath?: string;
    qmakeTarget?: string;
    vsVersion?: string;
}

export interface TargetProfile {
    id: string;
    name: string;
    kind: 'qt' | 'cpp';
    project: string;
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    runAt: 'local' | 'remote';
    toolchain: ToolchainConfig;
}

export interface QtModulePrefs {
    qmakeArgs: string;
    cStandard: string;
    cppStandard: string;
    designerPath: string;
    qtSourcePath: string;
    manualProPath: string;
    rccProjectPath: string;
    scanExcludeDirs: string[];
    customCommands: { name: string; command: string }[];
    suppressedWarnings: string[];
    fileSyncPromptEnabled: boolean;
    qmakeReminderEnabled: boolean;
}

export interface CppModulePrefs {
    scanDepth: number;
}

export interface WorkspaceConfig {
    workroot: string;
    activeTarget: string | null;
    targets: Record<string, TargetProfile>;
    qtModulePrefs: QtModulePrefs;
    cppModulePrefs: CppModulePrefs;
}

export interface WorkspacesRegistry {
    workroots: string[];
}

// ── Defaults ──

export const DEFAULT_QT_MODULE_PREFS: Readonly<QtModulePrefs> = {
    qmakeArgs: '',
    cStandard: 'c11',
    cppStandard: 'c++11',
    designerPath: '',
    qtSourcePath: '',
    manualProPath: '',
    rccProjectPath: '',
    scanExcludeDirs: [],
    customCommands: [],
    suppressedWarnings: [],
    fileSyncPromptEnabled: true,
    qmakeReminderEnabled: true,
};

export const DEFAULT_SDK_MODULE_PREFS: Readonly<CppModulePrefs> = {
    scanDepth: 8,
};

// ── Paths ──

export function workspacesRegistryPath(): string {
    return path.join(forjaConfigDir(), 'workspaces.json');
}

export function workspacesDir(): string {
    return path.join(forjaConfigDir(), 'workspaces');
}

export function normalizePath(p: string): string {
    const normalized = p.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function workspaceConfigPath(workroot: string): string {
    const normalized = normalizePath(workroot);
    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
    return path.join(workspacesDir(), `${hash}.json`);
}

// ── Atomic write helper ──

function atomicWriteFileSync(filePath: string, data: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
    const tmpPath = filePath + '.tmp.' + process.pid;
    try {
        fs.writeFileSync(tmpPath, data, 'utf8');
        fs.renameSync(tmpPath, filePath);
    } catch (e) {
        // Clean up temp file on failure
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        throw e;
    }
}

// ── Registry ──

export function loadWorkspacesRegistry(): WorkspacesRegistry {
    const filePath = workspacesRegistryPath();
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (Array.isArray(raw.workroots)) {
                return { workroots: raw.workroots.filter((r: unknown) => typeof r === 'string') };
            }
        }
    } catch {
        // corrupted — try recovery from per-workspace files
    }
    // Recovery: scan workspaces/ directory for orphan config files
    return recoverRegistry();
}

function recoverRegistry(): WorkspacesRegistry {
    const dir = workspacesDir();
    if (!fs.existsSync(dir)) { return { workroots: [] }; }
    const workroots: string[] = [];
    try {
        for (const file of fs.readdirSync(dir)) {
            if (!file.endsWith('.json')) continue;
            try {
                const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
                if (typeof raw.workroot === 'string' && raw.workroot) {
                    workroots.push(raw.workroot);
                }
            } catch { /* skip corrupted */ }
        }
    } catch { /* dir unreadable */ }
    if (workroots.length > 0) {
        // Persist recovered registry
        saveWorkspacesRegistry({ workroots });
    }
    return { workroots };
}

export function saveWorkspacesRegistry(registry: WorkspacesRegistry): void {
    atomicWriteFileSync(workspacesRegistryPath(), JSON.stringify(registry, null, 2));
}

// ── Per-workspace config ──

function sanitizeWorkspaceConfig(raw: Record<string, unknown>): WorkspaceConfig {
    const targets: Record<string, TargetProfile> = {};
    if (raw.targets && typeof raw.targets === 'object') {
        for (const [id, t] of Object.entries(raw.targets as Record<string, unknown>)) {
            if (t && typeof t === 'object') {
                const obj = t as Record<string, unknown>;
                const rawToolchain = (obj.toolchain && typeof obj.toolchain === 'object')
                    ? obj.toolchain as Record<string, unknown>
                    : {};
                const toolchain: ToolchainConfig = {};
                if (typeof rawToolchain.qtPath === 'string') toolchain.qtPath = rawToolchain.qtPath;
                if (typeof rawToolchain.qtVersion === 'string') toolchain.qtVersion = rawToolchain.qtVersion;
                if (typeof rawToolchain.vsInstall === 'string') toolchain.vsInstall = rawToolchain.vsInstall;
                if (typeof rawToolchain.jomPath === 'string') toolchain.jomPath = rawToolchain.jomPath;
                if (typeof rawToolchain.qmakeTarget === 'string') toolchain.qmakeTarget = rawToolchain.qmakeTarget;
                if (typeof rawToolchain.vsVersion === 'string') toolchain.vsVersion = rawToolchain.vsVersion;
                targets[id] = {
                    id: typeof obj.id === 'string' ? obj.id : id,
                    name: typeof obj.name === 'string' ? obj.name : id,
                    kind: obj.kind === 'cpp' ? 'cpp' : 'qt',
                    project: typeof obj.project === 'string' ? obj.project : '',
                    mode: obj.mode === 'release' ? 'release' : 'debug',
                    arch: obj.arch === 'x64' ? 'x64' : 'x86',
                    runAt: obj.runAt === 'remote' ? 'remote' : 'local',
                    toolchain,
                };
            }
        }
    }

    const sanitizeQtPrefs = (raw: unknown): QtModulePrefs => {
        const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
        return {
            qmakeArgs: typeof obj.qmakeArgs === 'string' ? obj.qmakeArgs : '',
            cStandard: typeof obj.cStandard === 'string' ? obj.cStandard : 'c11',
            cppStandard: typeof obj.cppStandard === 'string' ? obj.cppStandard : 'c++11',
            designerPath: typeof obj.designerPath === 'string' ? obj.designerPath : '',
            qtSourcePath: typeof obj.qtSourcePath === 'string' ? obj.qtSourcePath : '',
            manualProPath: typeof obj.manualProPath === 'string' ? obj.manualProPath : '',
            rccProjectPath: typeof obj.rccProjectPath === 'string' ? obj.rccProjectPath : '',
            scanExcludeDirs: Array.isArray(obj.scanExcludeDirs) ? obj.scanExcludeDirs.filter((d): d is string => typeof d === 'string') : [],
            customCommands: Array.isArray(obj.customCommands) ? obj.customCommands.filter((c): c is { name: string; command: string } => c && typeof c === 'object') : [],
            suppressedWarnings: Array.isArray(obj.suppressedWarnings) ? obj.suppressedWarnings.filter((w): w is string => typeof w === 'string') : [],
            fileSyncPromptEnabled: typeof obj.fileSyncPromptEnabled === 'boolean' ? obj.fileSyncPromptEnabled : true,
            qmakeReminderEnabled: typeof obj.qmakeReminderEnabled === 'boolean' ? obj.qmakeReminderEnabled : true,
        };
    };

    const sanitizeCppPrefs = (raw: unknown): CppModulePrefs => {
        const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
        return {
            scanDepth: typeof obj.scanDepth === 'number' ? obj.scanDepth : 8,
        };
    };

    return {
        workroot: typeof raw.workroot === 'string' ? raw.workroot : '',
        activeTarget: typeof raw.activeTarget === 'string' ? raw.activeTarget : null,
        targets,
        qtModulePrefs: sanitizeQtPrefs(raw.qtModulePrefs),
        cppModulePrefs: sanitizeCppPrefs(raw.cppModulePrefs),
    };
}

export function loadWorkspaceConfig(workroot: string): WorkspaceConfig {
    const filePath = workspaceConfigPath(workroot);
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return sanitizeWorkspaceConfig(raw);
        }
    } catch {
        // corrupted — return empty
    }
    return {
        workroot: normalizePath(workroot),
        activeTarget: null,
        targets: {},
        qtModulePrefs: { ...DEFAULT_QT_MODULE_PREFS },
        cppModulePrefs: { ...DEFAULT_SDK_MODULE_PREFS },
    };
}

export function saveWorkspaceConfig(config: WorkspaceConfig): void {
    const normalized = { ...config, workroot: normalizePath(config.workroot) };
    const filePath = workspaceConfigPath(normalized.workroot);
    atomicWriteFileSync(filePath, JSON.stringify(normalized, null, 2));
}

// ── Workroot resolution ──

export function resolveWorkroot(cwd: string): string | null {
    const registry = loadWorkspacesRegistry();
    if (registry.workroots.length === 0) { return null; }

    const normalizedCwd = normalizePath(cwd);
    let bestMatch: string | null = null;
    let bestLen = -1;

    for (const wr of registry.workroots) {
        const normalizedWr = normalizePath(wr);
        if (normalizedCwd === normalizedWr || normalizedCwd.startsWith(normalizedWr + '/')) {
            if (normalizedWr.length > bestLen) {
                bestLen = normalizedWr.length;
                bestMatch = wr;
            }
        }
    }

    return bestMatch;
}

export function isWorkrootRegistered(workroot: string): boolean {
    const registry = loadWorkspacesRegistry();
    const normalized = normalizePath(workroot);
    return registry.workroots.some(wr => normalizePath(wr) === normalized);
}

export function registerWorkroot(workroot: string): void {
    const registry = loadWorkspacesRegistry();
    const normalized = normalizePath(workroot);
    if (!registry.workroots.some(wr => normalizePath(wr) === normalized)) {
        registry.workroots.push(workroot);
        saveWorkspacesRegistry(registry);
    }
}

// ── Target helpers ──

export function generateTargetId(kind: 'qt' | 'cpp', projectPath: string, mode: string, arch: string, existingIds?: Set<string>): string {
    const basename = path.basename(projectPath, path.extname(projectPath));
    let id = `${kind}-${basename}-${mode}-${arch}`;

    if (existingIds && existingIds.has(id)) {
        const hash = crypto.createHash('sha256').update(`${projectPath}:${mode}:${arch}`).digest('hex').slice(0, 6);
        id = `${kind}-${basename}-${mode}-${arch}-${hash}`;
    }

    return id;
}

export function getActiveTarget(config: WorkspaceConfig): TargetProfile | null {
    if (!config.activeTarget) { return null; }
    return config.targets[config.activeTarget] ?? null;
}

export function createEmptyWorkspaceConfig(workroot: string): WorkspaceConfig {
    return {
        workroot: normalizePath(workroot),
        activeTarget: null,
        targets: {},
        qtModulePrefs: { ...DEFAULT_QT_MODULE_PREFS },
        cppModulePrefs: { ...DEFAULT_SDK_MODULE_PREFS },
    };
}
