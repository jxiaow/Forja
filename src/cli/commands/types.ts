/**
 * CLI types — v2 command consolidation.
 * No vscode dependency.
 */

// ── ActiveTarget ──

import type { TargetProfile } from '../../core/workspaceStore';

/** @deprecated Use TargetProfile directly. Kept as alias for backward compat. */
export type ActiveTarget = TargetProfile;

// ── Diagnostic ──

export type DiagnosticLevel = 'info' | 'warning' | 'error';

export interface Diagnostic {
    level: DiagnosticLevel;
    message: string;
    hint?: string;
    fix?: string;
    params?: Record<string, string>;
}

export function diag(level: DiagnosticLevel, message: string, hint?: string): Diagnostic {
    return { level, message, hint };
}

// ── Readiness ──

export type ReadinessState = 'ready' | 'configured' | 'blocked' | 'missing' | 'unknown' | 'not-selected';

export interface Readiness {
    target?: ReadinessState;
    toolchain?: ReadinessState;
    sync?: ReadinessState;
    remote?: ReadinessState;
    runtime?: ReadinessState;
}

// ── Candidates ──

export interface TargetCandidate {
    kind: 'qt' | 'cpp';
    project: string;
    label: string;
    current: boolean;
    configured: boolean;
    diagnostics: Diagnostic[];
}

// ── Runtime ──

export interface RuntimeState {
    running: boolean;
    pid?: number;
    executablePath?: string;
    logFile?: string;
}

// ── CommandPlan ──

export interface CommandPlan {
    mode: 'dryRun';
    commands?: string[];
    shellCommand?: string;
    willWrite?: string[];
    willRun?: string[];
}

// ── Server types ──

export interface ServerSummary {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authMode: 'key' | 'password';
    selected?: boolean;
}

export interface ServerDetail extends ServerSummary {
    privateKeyPath?: string;
    strictHostKeyChecking?: boolean;
}

// ── JSON Envelope ──

export interface ForjaJsonResult {
    ok: boolean;
    action: string;
    workspace?: string;
    workroot?: string;
    activeTarget?: ActiveTarget;
    diagnostics?: Diagnostic[];
    nextAction?: string;
}

// ── Env summary (for `list env`) ──

export interface EnvSummary {
    qt?: Array<{ path: string; version?: string; configured?: boolean }>;
    vs?: Array<{ path: string; version?: string; edition?: string; configured?: boolean }>;
    jom?: string;
    make?: boolean;
}

// ── Sync types ──

export interface SyncPlan {
    mode: 'dryRun';
    server: string;
    remotePath: string;
    repos: string[];
    pending: string[];
    deleted: string[];
    skipped: string[];
    skippedDetails?: Array<{ file: string; reason: string }>;
}

// ── Question protocol (for --json needs-input) ──

export interface Question {
    id: string;
    label: string;
    required?: boolean;
    default?: string | number;
    choices?: string[];
    choicesBy?: {
        questionId: string;
        values: Record<string, string[]>;
    };
    when?: Record<string, string>;
}

// ── Locale ──

export type Locale = 'en' | 'zh';

export function resolveLocale(langFlag?: string, storedLang?: string): Locale {
    if (langFlag === 'zh' || langFlag === 'en') { return langFlag; }
    if (storedLang === 'zh' || storedLang === 'en') { return storedLang; }
    const envLang = process.env.FORJA_LANG;
    if (envLang === 'zh' || envLang === 'en') { return envLang; }
    const sysLocale = (process.env.LC_ALL || process.env.LANG || '').toLowerCase();
    if (sysLocale.includes('zh')) { return 'zh'; }
    try {
        const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
        if (intlLocale.startsWith('zh')) { return 'zh'; }
    } catch { /* ignore */ }
    return 'en';
}

// ── Readiness text mapping ──

const READINESS_TEXT: Record<ReadinessState, { en: string; zh: string }> = {
    ready: { en: 'Ready', zh: '就绪' },
    configured: { en: 'Configured', zh: '已配置' },
    blocked: { en: 'Blocked', zh: '阻塞' },
    missing: { en: 'Missing', zh: '缺失' },
    unknown: { en: 'Unknown', zh: '未知' },
    'not-selected': { en: 'Not selected', zh: '未选择' },
};

export function readinessText(state: ReadinessState, locale: Locale): string {
    return READINESS_TEXT[state][locale];
}

const READINESS_SYMBOLS: Record<ReadinessState, string> = {
    ready: '✓',
    configured: '✓',
    blocked: '✗',
    missing: '✗',
    unknown: '⚠',
    'not-selected': '-',
};

export function readinessSymbol(state: ReadinessState): string {
    return READINESS_SYMBOLS[state] ?? '?';
}

// ── UI text i18n ──

const UI: Record<string, { en: string; zh: string }> = {
    // common
    error:                         { en: 'Error',                        zh: '错误' },
    warning:                       { en: 'Warning',                      zh: '警告' },
    info:                          { en: 'Info',                         zh: '信息' },
    hint:                          { en: 'hint',                        zh: '提示' },
    saved:                         { en: 'Saved',                       zh: '已保存' },
    detected:                      { en: 'Detected',                    zh: '检测到' },
    activeTarget:                  { en: 'Active target',               zh: '活动目标' },
    language:                      { en: 'Language',                    zh: '语言' },
    next:                          { en: 'Next',                        zh: '后续' },
    workspace:                     { en: 'Workspace',                   zh: '工作区' },
    changed:                       { en: 'Changed',                     zh: '已变更' },
    none:                          { en: '(none)',                       zh: '（无）' },
    noneFound:                     { en: '(none found)',                 zh: '（未找到）' },
    nothingDetected:               { en: '(nothing detected)',           zh: '（未检测到）' },
    notConfigured:                 { en: 'not configured',               zh: '未配置' },
    configured:                    { en: 'configured',                   zh: '已配置' },
    available:                     { en: 'available',                    zh: '可用' },
    cleared:                       { en: 'cleared',                      zh: '已清除' },
    // status
    readiness:                     { en: 'Readiness',                   zh: '就绪度' },
    toolchainLabel:                { en: 'Toolchain',                   zh: '工具链' },
    remoteLabel:                   { en: 'Remote',                      zh: '远程' },
    syncLabel:                     { en: 'Sync',                        zh: '同步' },
    runtimeLabel:                  { en: 'Runtime',                     zh: '运行时' },
    running:                       { en: 'running',                      zh: '运行中' },
    notRunning:                    { en: 'not running',                  zh: '未运行' },
    enabledStatus:                 { en: 'enabled',                      zh: '已启用' },
    disabledStatus:                { en: 'disabled',                     zh: '未启用' },
    executable:                    { en: 'executable',                  zh: '可执行文件' },
    log:                           { en: 'log',                         zh: '日志' },
    pid:                           { en: 'pid',                          zh: '进程' },
    // readiness keys
    readinessTarget:               { en: 'target',                       zh: '目标' },
    readinessToolchain:            { en: 'toolchain',                    zh: '工具链' },
    readinessSync:                 { en: 'sync',                         zh: '同步' },
    readinessRemote:               { en: 'remote',                       zh: '远程' },
    readinessRuntime:              { en: 'runtime',                      zh: '运行时' },
    // target detail labels
    projectLabel:                  { en: 'Project',                     zh: '项目' },
    modeLabel:                     { en: 'Mode',                        zh: '模式' },
    archLabel:                     { en: 'Arch',                        zh: '架构' },
    kind:                          { en: 'Kind',                        zh: '类型' },
    // status diagnostics
    noActiveTarget:                { en: 'No active target selected',    zh: '未选择活动目标' },
    notInitialized:                { en: 'Not initialized, no config found', zh: '未初始化，未找到配置' },
    statusSetupLocal:              { en: 'local setup',                     zh: '本地初始化' },
    statusSetupRemote:             { en: 'local + remote setup',            zh: '本地 + 远程初始化' },
    noSyncServer:                  { en: 'No sync server added',         zh: '未添加同步服务器' },
    remotePathNotConfigured:       { en: 'Remote path not configured',   zh: '远程路径未配置' },
    remoteNoServerConfigured:      { en: 'No remote server configured',  zh: '未配置远程服务器' },
    remoteForjaBinDefault:         { en: 'Remote Forja bin not configured, will use npm global prefix', zh: '远程 Forja 二进制未配置，将使用 npm 全局 prefix' },
    qtNotFound:                    { en: 'Qt not found at configured path', zh: '在配置路径未找到 Qt' },
    vsNotFound:                    { en: 'VS dev environment not found', zh: '未找到 VS 开发环境' },
    vsNotFoundDetail:              { en: 'VS dev environment not found (vsDevShell)', zh: '未找到 VS 开发环境（vsDevShell）' },
    jomNotFound:                   { en: 'jom not found (optional, recommended for faster builds)', zh: '未找到 jom（可选，建议安装以加速构建）' },
    makeNotFound:                  { en: 'make not found',              zh: '未找到 make' },
    // hints
    fileMayDeleted:                { en: 'The file may have been deleted or moved', zh: '文件可能已被删除或移动' },
    serverDeleted:                 { en: 'Server was deleted, please re-select', zh: '服务器已被删除，请重新选择' },
    qtReconfigure:                 { en: 'Qt installation may have changed, reconfigure with forja use', zh: 'Qt 安装可能已变更，请用 forja use 重新配置' },
    installVs:                     { en: 'Install Visual Studio and configure vcvarsall.bat', zh: '安装 Visual Studio 并配置 vcvarsall.bat' },
    installVsCpp:                  { en: 'Install Visual Studio and configure with forja use target --vs', zh: '安装 Visual Studio 并用 forja use target --vs 配置' },
    installBuildEssential:         { en: 'Install build-essential or equivalent', zh: '安装 build-essential 或同等工具' },
    deployRemote:                  { en: 'Run forja remote bootstrap to deploy the current CLI', zh: '运行 forja remote bootstrap 部署当前 CLI' },
    // list
    targets:                       { en: 'Targets',                      zh: '目标' },
    servers:                       { en: 'Servers',                      zh: '服务器' },
    environment:                   { en: 'Environment',                  zh: '环境' },
    remoteConfiguration:           { en: 'Remote Configuration',         zh: '远程配置' },
    workspaceMode:                 { en: 'Workspace mode',              zh: '工作区模式' },
    remoteWorkspace:               { en: 'Remote workspace',            zh: '远程工作区' },
    forjaBin:                      { en: 'Forja bin',                   zh: 'Forja 二进制' },
    buildOrder:                    { en: 'Build order',                 zh: '构建顺序' },
    transfer:                      { en: 'Transfer',                    zh: '传输' },
    repos:                         { en: 'Repos',                       zh: '仓库' },
    project:                       { en: 'project',                     zh: '项目' },
    mode:                          { en: 'mode',                        zh: '模式' },
    arch:                          { en: 'arch',                       zh: '架构' },
    enabled:                       { en: 'enabled=',                     zh: '已启用=' },
    server:                        { en: 'server=',                      zh: '服务器=' },
    path:                          { en: 'path',                        zh: '路径' },
    baseline:                      { en: 'baseline',                    zh: '基线' },
    artifacts:                     { en: 'artifacts',                   zh: '制品' },
    strictHostKey:                 { en: 'StrictHostKey',               zh: '严格主机密钥' },
    // use
    updated:                       { en: 'updated',                      zh: '已更新' },
    target:                        { en: 'Target',                      zh: '目标' },
    profile:                       { en: 'Profile',                     zh: '配置方案' },
    // server
    serverAdded:                   { en: 'Server added',                 zh: '服务器已添加' },
    serverUpdated:                 { en: 'Server updated',               zh: '服务器已更新' },
    serverRemoved:                 { en: 'Server removed',               zh: '服务器已移除' },
    id:                            { en: 'ID',                          zh: 'ID' },
    name:                          { en: 'Name',                        zh: '名称' },
    host:                          { en: 'Host',                        zh: '主机' },
    port:                          { en: 'Port',                        zh: '端口' },
    username:                      { en: 'Username',                    zh: '用户名' },
    auth:                          { en: 'Auth',                        zh: '认证' },
    key:                           { en: 'Key',                         zh: '密钥' },
    planDryRun:                    { en: 'Plan (dry run)',              zh: '计划（预演）' },
    wouldWrite:                    { en: 'Would write',                 zh: '将写入' },
    wouldRun:                      { en: 'Would run',                   zh: '将运行' },
    commands:                      { en: 'Commands',                    zh: '命令' },
    // sync
    syncPlan:                      { en: 'Sync plan (dry run)',          zh: '同步计划（预演）' },
    'sync.notConfigured':          { en: 'No sync server configured',   zh: '未配置同步服务器' },
    'syncInteractiveSetup':        { en: 'Interactive sync setup',       zh: '交互式同步配置' },
    'sync.serverNotFound':         { en: 'Server not found',            zh: '服务器未找到' },
    'sync.planFailed':             { en: 'Plan failed',                 zh: '计划失败' },
    'sync.syncFailed':             { en: 'Sync failed',                 zh: '同步失败' },
    'sync.remoteBlocked':          { en: 'Sync failed',                 zh: '同步失败' },
    'sync.unknownFlag':            { en: 'Unknown flag(s)',             zh: '未知参数' },
    'sync.unknownAction':          { en: 'Unknown sync action',         zh: '未知同步动作' },
    'sync.noRemotePath':           { en: 'Remote path not configured',  zh: '未配置远程路径' },
    'sync.noGitRepos':             { en: 'No git repositories found',   zh: '未找到 git 仓库' },
    'sync.filesNotFound':          { en: 'Specified files not found in any git root', zh: '指定文件在任何 git 仓库中均未找到' },
    'sync.passwordRequired':       { en: 'Password not provided. Set FORJA_SSH_PASSWORD or enter interactively', zh: '未提供密码。可通过环境变量 FORJA_SSH_PASSWORD 设置，或在 TTY 中交互输入' },
    'sync.passwordPrompt':         { en: 'Password for',                    zh: '输入' },
    'sync.ambiguous':              { en: 'matched multiple servers, use id', zh: '匹配到多个服务器，请使用 id' },
    'sync.createRemoteDirFailed':  { en: 'Create remote directory failed', zh: '创建远程目录失败' },
    'sync.resetDone':              { en: 'Sync state cleared; next sync will recalculate', zh: '已清除同步状态；下次同步会重新计算待同步文件' },
    syncConfirm:                   { en: 'Proceed with sync?',          zh: '确认执行同步？' },
    syncResetConfirm:              { en: 'Sync reset: clear all sync state. Continue?', zh: '同步重置：清除所有同步状态。继续？' },
    'sync.dryRunIncompatible':      { en: '--dry-run cannot be used with this subcommand', zh: '--dry-run 不能与此子命令一起使用' },
    'sync.fileOnlyForExecute':      { en: '--file can only be used with sync execute/plan', zh: '--file 只能在 sync 执行/计划时使用' },
    'sync.dryRunYesConflict':       { en: '--dry-run and --yes cannot be used together', zh: '--dry-run 和 --yes 不能同时使用' },
    'sync.ignoreFlagsOnlyWithIgnore': { en: '--add/--rm can only be used with sync ignore', zh: '--add/--rm 仅适用于 sync ignore' },
    syncIgnoreAddRmConflict:      { en: 'Cannot use --add and --rm together', zh: '不能同时使用 --add 和 --rm' },
    syncCancelled:                 { en: 'Sync cancelled',              zh: '同步已取消' },
    syncNothing:                   { en: 'Nothing to sync',             zh: '没有需要同步的内容' },
    syncComplete:                  { en: 'Sync complete',                zh: '同步完成' },
    syncStateReset:                { en: 'Sync state reset',             zh: '同步状态已重置' },
    syncIgnore:                    { en: 'Ignore',                        zh: '忽略' },
    syncIgnoreEmpty:               { en: 'No ignore patterns configured', zh: '未配置忽略规则' },
    syncIgnoreAdded:               { en: 'Added: {0}',                    zh: '已添加：{0}' },
    syncIgnoreRemoved:             { en: 'Removed: {0}',                  zh: '已移除：{0}' },
    syncIgnoreAlreadyExists:       { en: 'Already in ignore list: {0}',   zh: '已在忽略列表中：{0}' },
    syncIgnoreNotFound:            { en: 'Not in ignore list: {0}',       zh: '不在忽略列表中：{0}' },
    syncIgnorePatternRequired:     { en: 'Pattern required. Usage: forja sync ignore --add <pattern>', zh: '需要提供规则。用法：forja sync ignore --add <pattern>' },
    pending:                       { en: 'Pending',                      zh: '待同步' },
    uploaded:                      { en: 'Uploaded',                     zh: '已上传' },
    deleted:                       { en: 'Deleted',                      zh: '已删除' },
    skipped:                       { en: 'Skipped',                      zh: '已跳过' },
    // build/run/clean/stop
    build:                         { en: 'Build',                        zh: '构建' },
    buildSucceeded:                { en: 'succeeded',                    zh: '成功' },
    buildFailed:                   { en: 'failed',                       zh: '失败' },
    duration:                      { en: 'Duration',                    zh: '耗时' },
    errors:                        { en: 'Errors',                      zh: '错误' },
    warnings:                      { en: 'Warnings',                    zh: '警告' },
    run:                           { en: 'Run',                          zh: '运行' },
    runCompleted:                  { en: 'completed',                    zh: '已完成' },
    runFailed:                     { en: 'failed',                       zh: '失败' },
    pidLabel:                      { en: 'PID',                          zh: '进程ID' },
    clean:                         { en: 'Clean',                        zh: '清理' },
    cleanSucceeded:                { en: 'succeeded',                    zh: '成功' },
    cleanFailed:                   { en: 'failed',                       zh: '失败' },
    cleaned:                       { en: 'Cleaned',                     zh: '已清理' },
    state:                         { en: 'State',                       zh: '状态' },
    processStopped:                { en: 'Process stopped',              zh: '进程已停止' },
    noRunningProcess:              { en: 'No running process',           zh: '没有运行中的进程' },
    stopNotSupported:              { en: 'Stop not supported for this target', zh: '此目标不支持停止' },
    stopCppUnsupported:            { en: 'C++ target does not support stop. C++ builds are not long-running.', zh: 'C++ 目标不支持停止。C++ 构建不是长运行进程。' },
    stopTerminateFailed:           { en: 'Failed to terminate process',  zh: '终止进程失败' },
    stopStillRunning:              { en: 'Process still running',        zh: '进程仍在运行' },
    // list extras
    configuredMark:                { en: '[configured]',                 zh: '[已配置]' },
    serverIdLabel:                 { en: 'ID',                          zh: 'ID' },
    serverNameLabel:               { en: 'Name',                        zh: '名称' },
    serverHostLabel:               { en: 'Host',                        zh: '主机' },
    serverPortLabel:               { en: 'Port',                        zh: '端口' },
    serverUsernameLabel:           { en: 'Username',                    zh: '用户名' },
    serverAuthLabel:               { en: 'Auth',                        zh: '认证' },
    // list env labels
    qtLabel:                       { en: 'Qt',                          zh: 'Qt' },
    vsLabel:                       { en: 'VS',                          zh: 'VS' },
    jomLabel:                      { en: 'jom',                         zh: 'jom' },
    makeLabel:                     { en: 'make',                        zh: 'make' },
    roleLabel:                     { en: 'role',                        zh: '角色' },
    // setup summary labels (used by use.ts / report.ts)
    setupTitle:                    { en: 'Target Configuration',          zh: 'Forja 初始化' },
    setupSummaryQt:                { en: 'Qt',                           zh: 'Qt' },
    setupSummaryVs:                { en: 'VS',                           zh: 'VS' },
    setupSummaryModeArch:          { en: 'Mode/Arch',                    zh: '模式/架构' },
    // server selection (used by index.ts)
    setupSelectServer:             { en: 'Select a server',                zh: '选择服务器' },
    setupRemotePathPrompt:         { en: 'Remote path',                     zh: '远程路径' },
    // server creation (used by index.ts)
    setupServerCreated:            { en: 'Server created',                zh: '已创建服务器' },
    setupPromptHost:               { en: 'Host address',                  zh: '主机地址' },
    setupPromptUsername:           { en: 'Username',                      zh: '用户名' },
    setupPromptPort:               { en: 'Port',                          zh: '端口' },
    setupPromptAuthMode:           { en: 'Auth mode',                     zh: '认证方式' },
    setupAuthKey:                  { en: 'Key',                           zh: '密钥' },
    setupAuthPassword:             { en: 'Password',                      zh: '密码' },
    setupPromptPrivateKey:         { en: 'Private key path',              zh: '私钥路径' },
    setupPromptPassword:           { en: 'Password',                      zh: '密码' },
    setupPromptName:               { en: 'Server name',                   zh: '服务器名称' },
    // answers / questions (used by useTarget)
    setupAnswersLoadFailed:        { en: 'Failed to load answers file', zh: '加载答案文件失败' },
    setupQuestionTarget:           { en: 'Select target',                 zh: '选择目标' },
    setupQuestionQtPath:           { en: 'Qt path',                       zh: 'Qt 路径' },
    setupQuestionVsInstall:        { en: 'VS install',                    zh: 'VS 安装' },
    setupQuestionMode:             { en: 'Build mode',                    zh: '构建模式' },
    setupQuestionArch:             { en: 'Target arch',                   zh: '目标架构' },
    // sync extras
    serverLabel:                   { en: 'Server',                      zh: '服务器' },
    remotePathLabel:               { en: 'Remote path',                 zh: '远程路径' },
    // help texts
    'help.toplevel': {
        en: `Usage: forja <command> [action] [options]

Commands:
  init       Register work root and configure initial target
  status     Show workspace readiness
  list       List targets, env
  use        Select target and execution mode
  server     Manage remote servers (add/update/remove)
  remote     Manage remote configuration
  build      Build the active target
  run        Run the built application
  stop       Stop a running application
  clean      Clean build artifacts
  sync       Sync files with remote server

Global options:
  --help, -h       Show help
  --version, -v    Show version
  --json           JSON output
  --lang <locale>  Language: zh or en
  --workspace <p>  Specify workspace (default: cwd)`,
        zh: `用法: forja <命令> [动作] [选项]

命令:
  init       注册工作根目录并配置初始目标
  status     查看工作区就绪状态
  list       列出目标、环境
  use        选择目标和执行模式
  server     管理远程服务器（添加/更新/删除）
  remote     管理远程配置
  build      构建当前目标
  run        运行已构建的应用
  stop       停止运行中的应用
  clean      清理构建产物
  sync       与远程服务器同步文件

全局选项:
  --help, -h       显示帮助
  --version, -v    显示版本
  --json           JSON 输出
  --lang <locale>  语言: zh 或 en
  --workspace <p>  指定工作区（默认当前目录）`,
    },
    'help.status': {
        en: `Usage:
  forja status                     Show workspace readiness and runtime status

Options:
  --json                  Output as JSON
  --lang <locale>         Language: zh or en
  --workspace <path>      Workspace directory (default: current directory)`,
        zh: `用法:
  forja status                     查看工作区就绪状态和运行时信息

选项:
  --json                  JSON 格式输出
  --lang <locale>         语言: zh 或 en
  --workspace <路径>      工作区目录（默认当前目录）`,
    },
    'help.list': {
        en: `Usage:
  forja list targets               List saved targets
  forja list targets --all         Include discovered targets (scan)
  forja list env                   List all environment tools
  forja list env --qt|--vs|--jom|--make  List specific environment tool

Options:
  --json                  Output as JSON`,
        zh: `用法:
  forja list targets               列出已保存目标
  forja list targets --all         同时列出扫描发现的目标
  forja list env                   列出所有环境工具
  forja list env --qt|--vs|--jom|--make  列出指定环境工具

选项:
  --json                  JSON 格式输出`,
    },
    'help.use': {
        en: `Usage: forja use target [options] [--json]
       forja use --jobs <N>          Set global parallel build jobs (persisted)

Target options:
  --project <path>        Select target by project path or label
  --answers <file>        Continue a needs-input flow from a JSON answers file
  --mode <debug|release>  Set build mode
  --arch <x86|x64>        Set target architecture
  --qt <path>             Set Qt installation path
  --vs <path>             Set Visual Studio installation path
  --jom <path>            Set jom installation path
  --executable-name <name> Rename executable after build (overrides .pro TARGET)
  --build-script <path>   Set custom build script (.sh/.bat, C++ targets only)
  suppress-warnings [codes]     Manage suppressed warnings (no args = show)
    --add <codes>               Add to list
    --rm <codes>                Remove from list`,
        zh: `用法: forja use target [选项] [--json]
       forja use --jobs <N>          设置全局并行编译数（持久化）

Target 选项:
  --project <路径>        按项目路径或标签选择目标
  --answers <文件>        使用 JSON 答案文件继续 needs-input 流程
  --mode <debug|release>  设置构建模式
  --arch <x86|x64>        设置目标架构
  --qt <路径>             设置 Qt 安装路径
  --vs <路径>             设置 Visual Studio 安装路径
  --jom <路径>            设置 jom 安装路径
  --executable-name <名称> 构建后重命名可执行文件（覆盖 .pro 的 TARGET）
  --build-script <路径>   设置自定义构建脚本（.sh/.bat，仅 C++ 目标）
  suppress-warnings [代码]      管理被过滤的构建警告（无参数=查看）
    --add <代码>                追加到列表
    --rm <代码>                 从列表删除`,
    },
    'help.remote': {
        en: `Usage: forja remote [action] [options] [--json]

  forja remote                                    Show remote configuration
  forja remote setup [--server <name> --remote-path <path>]
                                                  Configure sync and bootstrap remote Forja
  forja remote bootstrap                         Package and install the current local CLI remotely
`,
        zh: `用法: forja remote [动作] [选项] [--json]

  forja remote                                    显示远程配置
  forja remote setup [--server <名称> --remote-path <路径>]
                                                  配置同步并部署远端 Forja
  forja remote bootstrap                         打包当前本地 CLI 并安装到远端
`,
    },
    'help.build': {
        en: `Usage:
  forja build                      Build current active target
  forja build fresh                Clean and rebuild from scratch
  forja build qmake                Regenerate Makefile only
  forja build rcc                  Compile Qt resource files only

Options:
  --plan                  Dry run, show commands without executing
  --project <path>        Build a specific project file (.pro/.sln/Makefile/CMakeLists.txt)
  --jobs <N>              Parallel build jobs (e.g. -jN / jom /m:N; omit to use saved default)
  --build-args <args>     Extra arguments appended to the build command
  --json                  Output as JSON
  --lang <locale>         Language: zh or en
  --workspace <path>      Workspace directory (default: current directory)`,
        zh: `用法:
  forja build                      构建当前活动目标
  forja build fresh                清理后全量重建
  forja build qmake                仅重新生成 Makefile
  forja build rcc                  仅编译 Qt 资源文件

选项:
  --plan                  预演模式，只显示命令不执行
  --project <路径>        构建指定项目文件（.pro/.sln/Makefile/CMakeLists.txt）
  --jobs <N>              并行编译数（如 -jN / jom /m:N；不指定则使用已保存的默认值）
  --build-args <参数>     追加到构建命令的额外参数
  --json                  JSON 格式输出
  --lang <locale>         语言: zh 或 en
  --workspace <路径>      工作区目录（默认当前目录）`,
    },
    'help.run': {
        en: `Usage: forja run [subcommand] [options] [--json]

Subcommands:
  designer <ui-file>                       Open Qt Designer with UI file
  custom <name>                            Run custom command

Options:
  --detach                                 Run in background
  --plan                                   Dry run, show commands without executing
  --json                                   Output as JSON`,
        zh: `用法: forja run [子命令] [选项] [--json]

子命令:
  designer <ui文件>                        打开 Qt Designer 加载 UI 文件
  custom <名称>                            运行自定义命令

选项:
  --detach                                 后台运行
  --plan                                   预演模式，只显示命令不执行
  --json                                   JSON 输出`,
    },
    'help.stop': {
        en: 'Usage: forja stop [--json]',
        zh: '用法: forja stop [--json]',
    },
    'help.clean': {
        en: 'Usage: forja clean [--plan] [--json]',
        zh: '用法: forja clean [--plan] [--json]',
    },
    // init diagnostics
    'init.projectNotFound':              { en: 'Project not found in workspace',      zh: '工作区中未找到项目' },
    'init.foundQtCppNotAutoSelecting':   { en: 'Found Qt and C++ targets, not auto-selecting', zh: '找到 Qt 和 C++ 目标，未自动选择' },
    'init.foundTargetsNotAutoSelecting': { en: 'Found targets, not auto-selecting',          zh: '找到多个目标，未自动选择' },
    'init.noTargetsToolchainOnly':       { en: 'No Qt or C++ targets found, only toolchain defaults saved', zh: '未找到 Qt 或 C++ 目标，仅保存了工具链默认值' },
    'init.qtMissing':                    { en: 'Qt installation not detected',        zh: '未检测到 Qt 安装' },
    'init.vsMissing':                    { en: 'Visual Studio installation not detected', zh: '未检测到 Visual Studio 安装' },
    'init.jomMissing':                   { en: 'jom not detected (optional, recommended for faster Qt builds on Windows)', zh: '未检测到 jom（可选，建议安装以加速 Windows 上的 Qt 构建）' },
    'init.makeMissing':                  { en: 'make not detected',                   zh: '未检测到 make' },
    'init.selectTarget':                 { en: 'Select a target project', zh: '选择目标项目' },
    'init.currentTarget':                { en: 'Current target',          zh: '当前目标' },
    'init.skipSelection':                { en: 'Skip (select later)',      zh: '跳过（稍后选择）' },
    'init.selectMode':                   { en: 'Select build mode',        zh: '选择构建模式' },
    'init.selectArch':                   { en: 'Select target architecture', zh: '选择目标架构' },
    'init.selectQt':                     { en: 'Select Qt installation',   zh: '选择 Qt 安装' },
    'init.selectVs':                     { en: 'Select Visual Studio',      zh: '选择 Visual Studio' },
    'init.rccProject':                   { en: 'RCC project path (optional)', zh: 'RCC 项目路径（可选）' },
    'init.rccSkip':                      { en: 'Skip',                       zh: '跳过' },
    'init.rccManual':                    { en: 'Enter path manually...',     zh: '手动输入路径...' },
    'init.executableName':               { en: 'Executable name',           zh: '可执行文件名' },
    'init.executableNameHint':           { en: 'rename after build; Enter to skip', zh: '构建后重命名；回车跳过' },
    'init.default':                      { en: 'default',                   zh: '默认' },
    'init.usingDefault':                 { en: 'using default',             zh: '使用默认值' },
    'init.currentQt':                    { en: 'Current Qt',                zh: '当前 Qt' },
    'init.currentVs':                    { en: 'Current VS',                zh: '当前 VS' },
    'init.currentJom':                   { en: 'Current jom',               zh: '当前 jom' },
    'init.noLocalTargetsSkipRemote':     { en: 'No local targets detected; skipping remote bridge init. Use `forja use target` first.', zh: '未检测到本地目标；跳过远程桥接初始化。请先使用 `forja use target`。' },
    // workroot init (forja init)
    'init.title':                       { en: 'Workspace initialized',               zh: '工作区已初始化' },
    'init.workroot':                    { en: 'Work root',                            zh: '工作根目录' },
    'init.newlyRegistered':             { en: '(newly registered)',                   zh: '（新注册）' },
    'init.project':                     { en: 'Project',                              zh: '项目' },
    'init.modeArch':                    { en: 'Mode / Arch',                          zh: '模式 / 架构' },
    'init.qt':                          { en: 'Qt',                                   zh: 'Qt' },
    'init.vs':                          { en: 'Visual Studio',                        zh: 'Visual Studio' },
    'init.workrootNotFound':            { en: 'Work root not found',                  zh: '工作根目录不存在' },
    'init.workrootAlreadyRegistered':   { en: 'Work root is already registered',      zh: '工作根目录已注册' },
    'init.workrootNotRegistered':       { en: 'Work root is not registered. Run `forja init` first.', zh: '工作根目录未注册。请先运行 `forja init`。' },
    'init.existingTargets':             { en: 'Existing targets',                     zh: '已有目标' },
    'init.selectAction':                { en: 'What would you like to do?',           zh: '你想做什么？' },
    'init.addAction':                   { en: 'Add a new target',                     zh: '添加新目标' },
    'init.modifyAction':                { en: 'Modify an existing target',            zh: '修改现有目标' },
    'init.exitAction':                  { en: 'Exit',                                 zh: '退出' },
    'init.newWorkroot':                 { en: 'Initializing new workspace',           zh: '初始化新工作区' },
    'init.confirmWorkroot':             { en: 'Use this directory as work root?',      zh: '使用此目录作为工作根目录？' },
    'init.workrootHint':                { en: 'The work root is the top-level directory under which all build targets are managed.', zh: '工作根目录是管理所有构建目标的最顶层目录。' },
    'init.workrootSuggestion':          { en: 'Choose the root that contains all project files — not a subdirectory (e.g. src/, build/) — otherwise targets outside it will be inaccessible.', zh: '应选择包含所有项目文件的顶层目录，而非子目录（如 src/、build/），否则后续无法访问上级目录中的其他目标。' },
    'init.foundProjects':               { en: 'Found projects',                       zh: '找到项目' },
    'init.noProjectsFound':             { en: 'No projects found in work root',       zh: '工作根目录下未找到项目' },
    'init.selectProjectGroup':          { en: 'Select a project group',               zh: '选择项目分组' },
    'init.selectProject':               { en: 'Select a project',                     zh: '选择项目' },
    'init.manualProjectPath':           { en: 'Enter project path manually...',        zh: '手动输入项目路径...' },
    'init.enterProjectPath':            { en: 'Enter project file path',               zh: '输入项目文件路径' },
    'init.noTargetsToModify':           { en: 'No targets to modify',                 zh: '没有可修改的目标' },
    'init.answersMissingProject':       { en: 'Answers file missing required "project" field', zh: '答案文件缺少必需的 "project" 字段' },
    'init.targetNotFound':              { en: 'Target not found',                       zh: '目标未找到' },
    'init.answersMissingTarget':        { en: 'Answers file missing required "target" field for modify action', zh: '修改操作的答案文件缺少必需的 "target" 字段' },
    'init.selectTargetToModify':        { en: 'Select target to modify',              zh: '选择要修改的目标' },
    'init.configurationCancelled':      { en: 'Configuration cancelled',              zh: '配置已取消' },
    'init.existingAction':              { en: 'Action for existing workroot',         zh: '对已注册工作根目录的操作' },
    'init.invalidMode':                 { en: 'Invalid mode value: {0}. Must be debug or release.', zh: '无效的 mode 值: {0}。必须为 debug 或 release。' },
    'init.invalidArch':                 { en: 'Invalid arch value: {0}. Must be x86 or x64.',     zh: '无效的 arch 值: {0}。必须为 x86 或 x64。' },
    'init.invalidAction':              { en: 'Invalid action value: {0}. Must be add, modify, or exit.', zh: '无效的 action 值: {0}。必须为 add、modify 或 exit。' },
    'help.init': {
        en: `Usage:
  forja init                     Register work root and configure initial target
  forja init --workroot <path>   Specify work root directory

Options:
  --workroot <path>       Work root directory (default: current directory)
  --answers <file>        JSON file with pre-configured answers (for automation)
  --lang <zh|en>          Set display language (persisted)
  --json                  Output as JSON`,
        zh: `用法:
  forja init                     注册工作根目录并配置初始目标
  forja init --workroot <path>   指定工作根目录

选项:
  --workroot <path>       工作根目录（默认当前目录）
  --answers <file>        预配置答案的 JSON 文件（用于自动化）
  --lang <zh|en>          设置显示语言（持久化）
  --json                  JSON 格式输出`,
    },
    // index.ts dispatcher messages
    'idx.noCommand':                    { en: 'No command specified. Run `forja --help` for usage.', zh: '未指定命令。运行 `forja --help` 查看用法。' },
    'idx.unknownCommand':               { en: 'Unknown command',                    zh: '未知命令' },
    'idx.unknownFlags':                 { en: 'Unknown flag(s)',                    zh: '未知参数' },
    'idx.listCategoryRequired':         { en: 'Category required. Usage: forja list <targets|env>', zh: '需要指定分类。用法: forja list <targets|env>' },
    'idx.unknownListCategory':          { en: 'Unknown list category',              zh: '未知列表分类' },
    'idx.validCategories':              { en: 'Valid categories',                   zh: '有效分类' },
    'idx.envSingleFilterOnly':          { en: 'Specify only one env filter: --qt, --vs, --jom, or --make', zh: '只能指定一个环境过滤器：--qt、--vs、--jom 或 --make' },
    'idx.envFlagsOnlyWithEnv':          { en: 'Env filter flags only valid with list env', zh: '环境过滤 flag 仅适用于 list env' },
    'idx.allOnlyWithTargets':           { en: '--all only valid with list targets',          zh: '--all 仅适用于 list targets' },
    'idx.unknownUseSubcommand':         { en: 'Unknown use subcommand',             zh: '未知 use 子命令' },
    'idx.invalidPort':                  { en: 'Invalid port',                       zh: '无效端口' },
    'idx.invalidPortHint':              { en: 'Must be a number between 1 and 65535.', zh: '必须是 1 到 65535 之间的数字。' },
    'idx.unknownServerSubcommand':      { en: 'Unknown server subcommand',          zh: '未知 server 子命令' },
    'idx.unknownRemoteSubcommand':      { en: 'Unknown remote subcommand',          zh: '未知 remote 子命令' },
    'remote.setRequiresFlag':           { en: 'Specify --server and/or --remote-path', zh: '请指定 --server 和/或 --remote-path' },
    'remote.showNoFlags':               { en: '--server and --remote-path are only valid with `forja remote setup`', zh: '--server 和 --remote-path 仅在 `forja remote setup` 中有效' },
    'remote.invalidPath':               { en: 'Invalid path (must be relative, no \'..\')', zh: '无效路径（必须是相对路径，不能包含 \'..\'）' },
    'remote.invalidRepoName':           { en: 'Invalid repo name',                        zh: '无效仓库名' },
    'remote.invalidRepoNameChars':      { en: 'Invalid repo name (no \'..\'  / \\ ~ allowed)', zh: '无效仓库名（不能包含 \'..\'  / \\ ~）' },
    'remote.cleanFailedWarning':        { en: 'Clean untracked files failed after reset', zh: '重置后清理未跟踪文件失败' },
    'remote.setUpdated':               { en: 'Remote set updated',                     zh: '远程设置已更新' },
    'remote.restoreUpdated':           { en: 'Remote restore updated',                  zh: '远程恢复已更新' },
    'remote.resetUpdated':             { en: 'Remote reset updated',                    zh: '远程重置已更新' },
    'idx.serverIdRequired':             { en: 'Server ID required',                   zh: '需要服务器 ID' },
    'idx.unknownBuildAction':           { en: 'Unknown build action',               zh: '未知构建动作' },
    'idx.validActions':                 { en: 'Valid actions: fresh, qmake, rcc',   zh: '有效动作: fresh, qmake, rcc' },
    'idx.runDesignerUsage':             { en: 'Usage: forja run designer <ui-file>', zh: '用法: forja run designer <ui文件>' },
    'idx.unknownArgument':              { en: 'Unknown argument',                   zh: '未知参数' },
    'idx.runDesignerHint':              { en: "Use 'forja run designer <ui-file>' for UI designer.", zh: '使用 \'forja run designer <ui文件>\' 打开 UI 设计器。' },
    'idx.unexpectedArgument':           { en: 'Unexpected argument',                zh: '意外参数' },
    'idx.didYouMean':                   { en: 'Did you mean',                       zh: '你是否想' },
    'idx.unknownSubcommand':            { en: 'Unknown subcommand',                 zh: '未知子命令' },
    // server diagnostics
    'srv.missingName':                  { en: 'Missing required: --name',           zh: '缺少必填参数：--name' },
    'srv.missingHost':                  { en: 'Missing required: --host',           zh: '缺少必填参数：--host' },
    'srv.missingUsername':              { en: 'Missing required: --username',       zh: '缺少必填参数：--username' },
    'srv.keyRequiresKeyOrPassword':     { en: 'auth-mode=key requires --private-key-path', zh: 'auth-mode=key 需要 --private-key-path' },
    'srv.passwordRequiresPasswordMode': { en: '--password requires --auth-mode password', zh: '--password 需要同时指定 --auth-mode password' },
    'srv.keyPathRequiresKeyMode':       { en: '--private-key-path requires --auth-mode key', zh: '--private-key-path 需要同时指定 --auth-mode key' },
    'srv.strictHostFlagsConflict':      { en: 'Specify only one of --strict-host-key-checking and --no-strict-host-key-checking', zh: '--strict-host-key-checking 和 --no-strict-host-key-checking 只能指定一个' },
    'srv.passwordRequiresPassword':     { en: 'auth-mode=password requires --password', zh: 'auth-mode=password 需要 --password' },
    'srv.noCredentials':                { en: 'No credentials provided; server will default to key auth. Use --private-key-path or --password to configure', zh: '未提供凭证；服务器将默认使用密钥认证。请使用 --private-key-path 或 --password 配置' },
    'srv.failedToSave':                 { en: 'Failed to save',                     zh: '保存失败' },
    'srv.serverNotFound':               { en: 'Server not found',                   zh: '服务器未找到' },
    'srv.duplicateName':                { en: 'Server name already exists',         zh: '服务器名称已存在' },
    // status diagnostics
    'sts.workspaceNotFound':            { en: 'Workspace does not exist',           zh: '工作区不存在' },
    'sts.configCorrupted':              { en: 'Config file parse failed',               zh: '配置文件解析失败' },
    'sts.configCorruptedHint':           { en: 'File may be corrupted, delete and re-run forja use target', zh: '文件可能已损坏，请删除后重新运行 forja use target' },
    'sts.projectFileMissing':           { en: 'Project file does not exist',        zh: '项目文件不存在' },
    'sts.failedToReadRunState':         { en: 'Failed to read run state',           zh: '读取运行状态失败' },
    'sts.forjaStatus':                  { en: 'Forja status',                       zh: 'Forja 状态' },
    'sts.globalJobs':                   { en: 'Build jobs',                         zh: '并行编译数' },
    'sts.globalJobsNotSet':             { en: 'not set (using all cores)',          zh: '未设置（使用全部核心）' },
    'sts.makefileMismatch':             { en: 'Makefile does not match current config', zh: 'Makefile 与当前配置不匹配' },
    'sts.makefileMismatchHint':         { en: 'Re-run qmake to regenerate Makefile', zh: '重新运行 qmake 以重新生成 Makefile' },
    'sts.makefileConfigMismatchHint':   { en: 'Change mode/arch to match Makefile, or re-run qmake', zh: '修改 mode/arch 以匹配 Makefile，或重新运行 qmake' },
    'sts.targetsFound':                 { en: 'Found {0} Qt and {1} C++ targets, none selected', zh: '找到 {0} 个 Qt 和 {1} 个 C++ 目标，未选择' },
    'sts.syncServerNotFound':           { en: 'Sync server "{0}" does not exist', zh: '同步服务器 "{0}" 不存在' },
    'sts.syncServerMissing':            { en: 'server not found',                  zh: '服务器未找到' },
    'sts.syncNotEnabled':               { en: 'Sync not configured; use forja remote setup', zh: '同步未配置，请使用 forja remote setup 配置' },
    // list diagnostics
    'lst.qtPathNotConfigured':          { en: 'Qt path not configured',             zh: 'Qt 路径未配置' },
    'lst.vsInstallNotConfigured':       { en: 'VS install not configured',          zh: 'VS 安装未配置' },
    'lst.serverNotFound':               { en: 'Server not found',                   zh: '服务器未找到' },
    'lst.savedTargets':                 { en: 'Saved targets',                      zh: '已保存目标' },
    'lst.discoveredTargets':            { en: 'Discovered (not saved)',              zh: '已发现（未保存）' },
    // use diagnostics
    'use.workspaceNotFound':             { en: 'Workspace does not exist',          zh: '工作区不存在' },
    'use.invalidMode':                   { en: 'Invalid mode',                      zh: '无效模式' },
    'use.invalidArch':                   { en: 'Invalid arch',                      zh: '无效架构' },
    'use.projectNotFound':              { en: 'Project file not found',            zh: '项目文件未找到' },
    'use.cannotDetermineKind':           { en: 'Cannot determine project kind from', zh: '无法从以下路径确定项目类型' },
    'use.failedToSaveTarget':              { en: 'Failed to save target',              zh: '保存目标失败' },
    'use.failedToSaveExecMode':          { en: 'Failed to save execution mode',     zh: '保存执行模式失败' },
    'use.noActiveTargetSelected':        { en: 'No active target selected',         zh: '未选择活动目标' },
    'use.selectTarget':                  { en: 'Select a target',                    zh: '选择目标' },
    'use.selectSavedTarget':             { en: 'Select saved target',                zh: '选择已保存的目标' },
    'use.addNewTarget':                  { en: '+ Add new target',                   zh: '+ 添加新目标' },
    'use.confirmChangeTarget':           { en: 'Change target?',                    zh: '是否更换目标？' },
    'use.multipleTargetsFound':          { en: 'Multiple targets found',            zh: '找到多个匹配目标' },
    'use.vsVersionMismatch':             { en: 'Qt requires VS {0}, not detected — please select manually', zh: 'Qt 需要 VS {0}，未检测到，请手动选择' },
    'use.toolchainNotConfigured':        { en: 'Toolchain not configured for this target', zh: '此目标未配置工具链' },
    'use.toolchainIncomplete':           { en: 'Toolchain is incomplete — some required paths are missing', zh: '工具链不完整——部分必需路径缺失' },
    'use.suppressWarningsRequiresFlag':  { en: 'Specify --add or --rm to modify the suppress-warnings list', zh: '请指定 --add 或 --rm 来修改抑制警告列表' },
    'use.serverNotFound':                { en: 'Server not found',                  zh: '服务器未找到' },
    'use.ambiguousServerName':           { en: 'Ambiguous server name',              zh: '服务器名称不明确' },
    'use.useServerIdInstead':            { en: 'Use server ID instead',              zh: '请改用服务器 ID' },
    'use.noServerConfigured':            { en: 'No server configured. Use --server <name> first.', zh: '未配置服务器。请先使用 --server <name>。' },
    'use.invalidLanguage':               { en: 'Invalid language',                   zh: '无效语言' },
    'use.useZhOrEn':                     { en: 'Use zh or en',                       zh: '请使用 zh 或 en' },
    'use.failedToSaveLanguage':          { en: 'Failed to save language',             zh: '保存语言失败' },
    'use.invalidRunAt':                  { en: 'Invalid execution location',          zh: '无效执行位置' },
    'use.useLocalOrRemote':              { en: 'Use local',                           zh: '请使用 local' },
    'use.execution':                     { en: 'Execution',                           zh: '执行位置' },
    'use.noChanges':                     { en: 'No changes — values already match',  zh: '无变更——当前值已匹配' },
    'use.buildScriptCppOnly':            { en: 'Build scripts are only supported for C++ targets', zh: '构建脚本仅支持 C++ 目标' },
    'use.buildScriptUnsupportedExtension': { en: 'Build script must use a .sh or .bat extension', zh: '构建脚本必须使用 .sh 或 .bat 扩展名' },
    'use.jobsSet':                       { en: 'Global build jobs set to {0}',       zh: '全局并行编译数已设为 {0}' },
    'use.jobsCleared':                   { en: 'Global build jobs cleared — using tool default', zh: '全局并行编译数已清除——使用工具默认值' },
    'use.jobsRequiresPositive':          { en: '--jobs requires a positive integer',  zh: '--jobs 需要正整数' },
    'use.globalJobs':                    { en: 'Build jobs',                          zh: '并行编译数' },
    // build/run/clean/stop shared diagnostics
    'cmd.cannotDetermineKind':           { en: 'Cannot determine project kind from', zh: '无法从以下路径确定项目类型' },
    'cmd.projectNotFound':               { en: 'Project file not found',             zh: '项目文件未找到' },
    'cmd.targetProjectMissing':          { en: 'Target project missing',             zh: '目标项目缺失' },
    'cmd.cppNoQmakeRcc':                 { en: 'C++ target does not support',        zh: 'C++ 目标不支持' },
    'cmd.rccNotRemote':                  { en: 'RCC is not supported on remote targets', zh: 'RCC 不支持远程目标' },
    'cmd.cppBuildFailed':                { en: 'C++ build failed',                   zh: 'C++ 构建失败' },
    'cmd.qtBuildFailed':                 { en: 'Qt build failed',                    zh: 'Qt 构建失败' },
    'cmd.cppRunUnsupported':             { en: 'C++ target does not support run. Build first.', zh: 'C++ 目标不支持运行。请先构建。' },
    'cmd.debugVscodeOnly':               { en: 'Debug is only available in VSCode. Use the "Forja: Debug" command from the Command Palette, or click the debug button in the status bar.', zh: '调试仅在 VSCode 中可用。使用命令面板中的 "Forja: Debug" 命令，或点击状态栏中的调试按钮。' },
    'cmd.cppCustomUnsupported':          { en: 'C++ target does not support custom commands', zh: 'C++ 目标不支持自定义命令' },
    'cmd.customNotFound':                { en: 'Custom command not found',           zh: '自定义命令未找到' },
    'cmd.customFailed':                  { en: 'Custom command failed',              zh: '自定义命令失败' },
    'cmd.customAvailable':               { en: 'Available',                          zh: '可用命令' },
    'cmd.buildErrorCount':               { en: '{0} error(s)',                        zh: '{0} 个错误' },
    'cmd.qtRunFailed':                   { en: 'Qt run failed',                      zh: 'Qt 运行失败' },
    'cmd.appExitedWithError':            { en: 'Application exited with error',      zh: '应用程序异常退出' },
    'cmd.targetNotSelected':             { en: 'Target not selected',                zh: '目标未选择' },
    'cmd.cppCleanFailed':                { en: 'C++ clean failed',                   zh: 'C++ 清理失败' },
    'cmd.qtCleanFailed':                 { en: 'Qt clean failed',                    zh: 'Qt 清理失败' },
    'cmd.stopFailedDetail':              { en: 'Failed to terminate process',        zh: '终止进程失败' },
    'cmd.stopStillRunningDetail':        { en: 'Process still running',              zh: '进程仍在运行' },
    'cmd.freshCleanFailed':              { en: 'Clean step of fresh build failed',   zh: '完全重建的清理步骤失败' },
    'cmd.noActiveTarget':                { en: 'No active target. Run `forja use target` or `forja use target --project <path>`.', zh: '未选择活动目标。运行 `forja use target` 或 `forja use target --project <path>`。' },
    'cmd.failedToSave':                  { en: 'Failed to save',                     zh: '保存失败' },
    'cmd.choosePrompt':                  { en: 'Select',                             zh: '请选择' },
    'cmd.chooseRequired':                { en: 'Please make a selection',            zh: '请选择一个选项' },
    // sync help fix — actual supported usage
    'help.sync.actual': {
        en: `Usage:
  forja sync                                        Sync changed files (interactive confirm)
  forja sync --yes                                  Skip confirmation
  forja sync --dry-run                              Preview pending changes
  forja sync reset                                  Clear sync state
  forja sync status                                 Show sync configuration
  forja sync ignore                                 List ignore patterns
  forja sync ignore --add <pattern>                 Add an ignore pattern
  forja sync ignore --rm <pattern>                  Remove an ignore pattern
  forja sync --file <path-or-glob>                  Sync specific file or glob (repeatable)

Options:
  --json                                  JSON output`,
        zh: `用法:
  forja sync                                        同步变更文件（交互确认）
  forja sync --yes                                  跳过确认
  forja sync --dry-run                              预览待同步文件
  forja sync reset                                  清除同步状态
  forja sync status                                 查看同步配置
  forja sync ignore                                 列出忽略规则
  forja sync ignore --add <pattern>                 添加忽略规则
  forja sync ignore --rm <pattern>                  移除忽略规则
  forja sync --file <路径或通配符>                  同步指定文件或通配符（可重复）

选项:
  --json                                  JSON 格式输出`,
    },
    // server help — document no-arg list behavior
    'help.server.full': {
        en: `Usage: forja server [<add|update|remove>] [options] [--json]

  forja server                  List all servers
  forja server --detail <id>    Show detailed info for a server
  forja server add              Add a new server
  forja server update <id>      Update an existing server
  forja server remove <id> [--force]
                                Remove a server (--force for non-interactive)`,
        zh: `用法: forja server [<add|update|remove>] [选项] [--json]

  forja server                  列出所有服务器
  forja server --detail <id>    查看指定服务器详细信息
  forja server add              添加新服务器
  forja server update <id>      更新已有服务器
  forja server remove <id> [--force]
                                删除服务器（非交互模式需 --force）`,
    },

    // ── Hardcoded string fixes — i18n keys ──

    // Execution location header (build/run/stop/clean)
    'execLocal':                         { en: '→ local',                             zh: '→ 本地' },
    'execRemote':                        { en: '→ remote:{0}',                        zh: '→ 远程:{0}' },

    // Cancelled / destructive action guards
    'cancelled':                         { en: 'Cancelled',                           zh: '已取消' },
    'destructiveRequiresForce':          { en: 'Destructive action requires --force in JSON mode', zh: '破坏性操作在 JSON 模式下需要 --force' },

    // Confirmation prompts
    'confirmRemoteReset':                { en: 'Remote reset: {0}. Continue?',        zh: '远程重置：{0}。继续？' },
    'confirmRemoveServer':               { en: "Remove server '{0}'?",                zh: "删除服务器 '{0}'？" },

    // Flag validation errors
    'langRequiresValue':                 { en: '--lang requires a value. Usage: forja <command> --lang zh|en', zh: '--lang 需要参数。用法：forja <command> --lang zh|en' },
    'workspaceRequiresValue':            { en: '--workspace requires a value. Usage: forja <command> --workspace <path>', zh: '--workspace 需要参数。用法：forja <command> --workspace <path>' },
    'unknownCommand':                    { en: 'Unknown command: {0}',                 zh: '未知命令：{0}' },

    // outputResult fallback
    'formatError':                       { en: 'Format error',                       zh: '格式化错误' },

    // Init answers file
    'initAnswersFileFailed':             { en: 'Failed to read answers file: {0}',     zh: '读取答案文件失败：{0}' },

    // Custom command requires name
    'runCustomRequiresName':             { en: 'forja run custom requires <name>',     zh: 'forja run custom 需要 <name>' },

    // Debug nextAction
    'debugNextAction':                   { en: 'Open VSCode Command Palette → "Forja: Debug"', zh: '打开 VSCode 命令面板 → "Forja: Debug"' },

    // Fallback error texts
    'unknownError':                      { en: 'unknown error',                       zh: '未知错误' },
    'remoteResetFailed':                 { en: 'Remote reset failed',                  zh: '远程重置失败' },
    'syncConfigFailed':                  { en: 'Failed to configure sync settings',    zh: '同步配置失败' },

    // Init (current) marker
    'currentMarker':                     { en: '(current)',                           zh: '(当前)' },

    // Init checkmark
    'selectedMark':                      { en: '✓',                                   zh: '✓' },

    // Suppress warnings
    'use.suppressedWarningsList':        { en: 'Suppressed warnings: {0}',             zh: '已抑制警告：{0}' },
    'use.noSuppressedWarnings':          { en: 'No suppressed warnings',               zh: '无已抑制警告' },
};

// Global locale state
let _globalLocale: Locale = 'en';

export function setGlobalLocale(locale: Locale): void {
    _globalLocale = locale;
}

export function getGlobalLocale(): Locale {
    return _globalLocale;
}

export function T(key: string, params?: string[]): string {
    const entry = UI[key];
    let text = entry ? entry[_globalLocale] : key;
    if (params) {
        for (let i = 0; i < params.length; i++) {
            text = text.replace(`{${i}}`, params[i]);
        }
    }
    return text;
}
