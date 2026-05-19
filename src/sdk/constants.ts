/** 命令 ID */
export const CMD_BUILD = 'compilot.sdk.build';
export const CMD_REBUILD = 'compilot.sdk.rebuild';
export const CMD_CLEAN = 'compilot.sdk.clean';
export const CMD_SHOW_ACTIONS = 'compilot.sdk.showActions';

/** 配置键名 */
export const CFG_PINNED_PROJECT = 'compilot.sdk.pinnedProject';
export const CFG_MODE = 'compilot.sdk.mode';
export const CFG_ARCH = 'compilot.sdk.arch';
export const CFG_VS_DEV_CMD_PATH = 'compilot.sdk.vsDevCmdPath';

/** 配置 section */
export const CFG_SECTION = 'compilot.sdk';

/** Context key */
export const CTX_ACTIVATED = 'compilot.sdk.activated';

/** Task source */
export const TASK_SOURCE = 'Compilot SDK';

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
