/**
 * 配置文件读写的纯 IO 逻辑 — 不依赖 vscode，可独立测试。
 */
import * as fs from 'fs';
import * as path from 'path';

export interface QtPilotSettings {
    qtPath: string;
    designerPath: string;
    qtSourcePath: string;
    vsDevShellPath: string;
    jomPath: string;
    pinnedProject: { root: string; relative: string } | null;
    arch: 'x86' | 'x64' | '';
    mode: 'debug' | 'release' | '';
    scanExcludeDirs: string[];
    target: string;
    cStandard: string;
    cppStandard: string;
    manualProPath: string;
    fileSyncPromptEnabled: boolean;
    qmakeReminderEnabled: boolean;
    rccProjectPath: string;
    customCommands: { name: string; command: string }[];
}

export const DEFAULT_SETTINGS: Readonly<QtPilotSettings> = {
    qtPath: '',
    designerPath: '',
    qtSourcePath: '',
    vsDevShellPath: '',
    jomPath: '',
    pinnedProject: null,
    arch: '',
    mode: '',
    scanExcludeDirs: [],
    target: '',
    cStandard: 'c11',
    cppStandard: 'c++11',
    manualProPath: '',
    fileSyncPromptEnabled: true,
    qmakeReminderEnabled: true,
    rccProjectPath: '',
    customCommands: []
};

export function settingsFilePath(workspace: string): string {
    return path.join(workspace, '.compilot', 'settings.json');
}

/** 从磁盘加载配置，缺失字段用默认值填充，无效值回落到默认值 */
export function loadSettings(workspace: string): QtPilotSettings {
    const filePath = settingsFilePath(workspace);
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            // 迁移: qmakeTarget → target
            if (raw.qmakeTarget && !raw.target) { raw.target = raw.qmakeTarget; delete raw.qmakeTarget; }
            return sanitizeSettings(raw);
        }
    } catch { /* file missing or malformed, use defaults */ }
    return { ...DEFAULT_SETTINGS };
}

function isString(v: unknown): v is string { return typeof v === 'string'; }
function isBool(v: unknown): v is boolean { return typeof v === 'boolean'; }
function isStringArray(v: unknown): v is string[] { return Array.isArray(v) && v.every(i => typeof i === 'string'); }

function sanitizeSettings(raw: Record<string, unknown>): QtPilotSettings {
    const d = DEFAULT_SETTINGS;

    // pinnedProject: must be { root: string, relative: string } or null
    let pinnedProject: QtPilotSettings['pinnedProject'] = null;
    if (raw.pinnedProject && typeof raw.pinnedProject === 'object') {
        const p = raw.pinnedProject as Record<string, unknown>;
        if (isString(p.root) && isString(p.relative)) {
            pinnedProject = { root: p.root, relative: p.relative };
        }
    }

    // customCommands: must be array of { name: string, command: string }
    let customCommands: QtPilotSettings['customCommands'] = d.customCommands;
    if (Array.isArray(raw.customCommands)) {
        customCommands = raw.customCommands.filter(
            (c: unknown) => !!c && typeof c === 'object' && isString((c as Record<string, unknown>).name) && isString((c as Record<string, unknown>).command)
        ) as QtPilotSettings['customCommands'];
    }

    return {
        qtPath: isString(raw.qtPath) ? raw.qtPath : d.qtPath,
        designerPath: isString(raw.designerPath) ? raw.designerPath : d.designerPath,
        qtSourcePath: isString(raw.qtSourcePath) ? raw.qtSourcePath : d.qtSourcePath,
        vsDevShellPath: isString(raw.vsDevShellPath) ? raw.vsDevShellPath : d.vsDevShellPath,
        jomPath: isString(raw.jomPath) ? raw.jomPath : d.jomPath,
        pinnedProject,
        arch: (raw.arch === 'x86' || raw.arch === 'x64' || raw.arch === '') ? raw.arch : d.arch,
        mode: (raw.mode === 'debug' || raw.mode === 'release' || raw.mode === '') ? raw.mode : d.mode,
        scanExcludeDirs: isStringArray(raw.scanExcludeDirs) ? raw.scanExcludeDirs : d.scanExcludeDirs,
        target: isString(raw.target) ? raw.target : d.target,
        cStandard: isString(raw.cStandard) ? raw.cStandard : d.cStandard,
        cppStandard: isString(raw.cppStandard) ? raw.cppStandard : d.cppStandard,
        manualProPath: isString(raw.manualProPath) ? raw.manualProPath : d.manualProPath,
        fileSyncPromptEnabled: isBool(raw.fileSyncPromptEnabled) ? raw.fileSyncPromptEnabled : d.fileSyncPromptEnabled,
        qmakeReminderEnabled: isBool(raw.qmakeReminderEnabled) ? raw.qmakeReminderEnabled : d.qmakeReminderEnabled,
        rccProjectPath: isString(raw.rccProjectPath) ? raw.rccProjectPath : d.rccProjectPath,
        customCommands
    };
}

/** 将配置写入磁盘 */
export function saveSettings(workspace: string, settings: QtPilotSettings): void {
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
