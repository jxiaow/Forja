/** 命令 ID */
export const CMD_BUILD = 'forja.sdk.build';
export const CMD_REBUILD = 'forja.sdk.rebuild';
export const CMD_CLEAN = 'forja.sdk.clean';
export const CMD_SHOW_ACTIONS = 'forja.sdk.showActions';
export const CMD_SELECT_PROJECT = 'forja.sdk.selectProject';

/** Context key */
export const CTX_ACTIVATED = 'forja.sdk.activated';

/** Task source */
export const TASK_SOURCE = 'Forja SDK';

/** 排除目录 */
export const EXCLUDE_DIRS = [
    'node_modules',
    'out',
    'dist',
    '.git',
    '.work'
];

/** 排除路径片段（用于匹配相对路径中的子路径） */
export const EXCLUDE_PATH_SEGMENTS = [
    'build/output'
];

/** 默认扫描深度 */
export const DEFAULT_SCAN_DEPTH = 8;

/** 扫描超时（毫秒） */
export const SCAN_TIMEOUT_MS = 30000;

/** VS 检测超时（毫秒） */
export const VS_DETECT_TIMEOUT_MS = 10000;
