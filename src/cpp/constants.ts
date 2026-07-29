/** Context key */
export const CTX_ACTIVATED = 'forja.cpp.activated';

/** Task source */
export const TASK_SOURCE = 'Forja C++';

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
