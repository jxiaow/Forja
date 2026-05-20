/**
 * Core types shared across all modules.
 * Extracted here to avoid core/ depending on qt/ or sdk/.
 */

export interface ProjectInfo {
    proPath: string;        // .pro 文件完整路径
    projectDir: string;     // 项目目录（相对于 workspace）
    proFile: string;        // .pro 文件名
    target: string;         // TARGET 名称（显示用，从 .pro 粗略解析）
    qtModules: string[];    // QT 模块列表
    defines: string[];      // DEFINES
}

export interface VSInfo {
    version: string;
    edition: string;
    installPath: string;
    devShellPath: string;
}

export interface QtInfo {
    version: string;
    compiler: string;
    path: string;
}

export interface EnvInfo {
    vs: VSInfo | null;
    qt: QtInfo | null;
    qtCandidates: QtInfo[];
    vsCandidates: VSInfo[];
    jom: string | null;
}
