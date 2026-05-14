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
    selectedProject: { root: string; relative: string } | null;
    arch: 'x86' | 'x64';
    mode: 'debug' | 'release';
    scanExcludeDirs: string[];
    qmakeTarget: string;
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
    selectedProject: null,
    arch: 'x86',
    mode: 'debug',
    scanExcludeDirs: [],
    qmakeTarget: '',
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

/** 从磁盘加载配置，缺失字段用默认值填充 */
export function loadSettings(workspace: string): QtPilotSettings {
    const filePath = settingsFilePath(workspace);
    try {
        if (fs.existsSync(filePath)) {
            const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return { ...DEFAULT_SETTINGS, ...raw };
        }
    } catch {}
    return { ...DEFAULT_SETTINGS };
}

/** 将配置写入磁盘 */
export function saveSettings(workspace: string, settings: QtPilotSettings): void {
    const filePath = settingsFilePath(workspace);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 4) + '\n', 'utf8');
}
