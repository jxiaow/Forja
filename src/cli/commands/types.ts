/**
 * CLI types — v2 command consolidation.
 * No vscode dependency.
 */

// ── ActiveTarget ──

export interface ActiveTarget {
    kind: 'qt' | 'sdk';
    project: string;
    mode: 'debug' | 'release';
    arch: 'x86' | 'x64';
    runAt: 'local' | 'remote';
}

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
    kind: 'qt' | 'sdk';
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
    runAt: 'local' | 'remote';
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
    activeTarget?: ActiveTarget;
    diagnostics?: Diagnostic[];
    nextAction?: string;
    [key: string]: unknown;
}

// ── Env summary (for `list env`) ──

export interface EnvSummary {
    qt?: Array<{ path: string; version?: string }>;
    vs?: Array<{ path: string; version?: string }>;
    jom?: string;
    make?: boolean;
    qtAvailable?: Array<{ path: string; version?: string }>;
    vsAvailable?: Array<{ path: string; version?: string; edition?: string }>;
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

// ── Doctor CheckResult ──

export type CheckStatus = 'ready' | 'blocked' | 'warning' | 'skipped' | 'unknown';

export interface CheckResult {
    name: string;
    status: CheckStatus;
    message?: string;
    diagnostics?: Diagnostic[];
    nextAction?: string;
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

// ── UI text i18n ──

const UI: Record<string, { en: string; zh: string }> = {
    // common
    error:                         { en: 'Error',                        zh: '错误' },
    warning:                       { en: 'Warning',                      zh: '警告' },
    info:                          { en: 'Info',                         zh: '信息' },
    hint:                          { en: 'hint:',                        zh: '提示：' },
    saved:                         { en: 'Saved:',                       zh: '已保存：' },
    detected:                      { en: 'Detected:',                    zh: '检测到：' },
    activeTarget:                  { en: 'Active target:',               zh: '活动目标：' },
    language:                      { en: 'Language:',                    zh: '语言：' },
    next:                          { en: 'Next:',                        zh: '后续：' },
    workspace:                     { en: 'Workspace:',                   zh: '工作区：' },
    changed:                       { en: 'Changed:',                     zh: '已变更：' },
    none:                          { en: '(none)',                       zh: '（无）' },
    noneFound:                     { en: '(none found)',                 zh: '（未找到）' },
    nothingDetected:               { en: '(nothing detected)',           zh: '（未检测到）' },
    notConfigured:                 { en: 'not configured',               zh: '未配置' },
    configured:                    { en: 'configured',                   zh: '已配置' },
    available:                     { en: 'available',                    zh: '可用' },
    cleared:                       { en: 'cleared',                      zh: '已清除' },
    // status
    readiness:                     { en: 'Readiness:',                   zh: '就绪度：' },
    toolchainLabel:                { en: 'Toolchain:',                   zh: '工具链：' },
    remoteLabel:                   { en: 'Remote:',                      zh: '远程：' },
    syncLabel:                     { en: 'Sync:',                        zh: '同步：' },
    runtimeLabel:                  { en: 'Runtime:',                     zh: '运行时：' },
    running:                       { en: 'running',                      zh: '运行中' },
    notRunning:                    { en: 'not running',                  zh: '未运行' },
    enabledStatus:                 { en: 'enabled',                      zh: '已启用' },
    disabledStatus:                { en: 'disabled',                     zh: '未启用' },
    executable:                    { en: 'executable:',                  zh: '可执行文件：' },
    log:                           { en: 'log:',                         zh: '日志：' },
    pid:                           { en: 'pid ',                          zh: '进程 ' },
    // readiness keys
    readinessTarget:               { en: 'target',                       zh: '目标' },
    readinessToolchain:            { en: 'toolchain',                    zh: '工具链' },
    readinessSync:                 { en: 'sync',                         zh: '同步' },
    readinessRemote:               { en: 'remote',                       zh: '远程' },
    readinessRuntime:              { en: 'runtime',                      zh: '运行时' },
    // target detail labels
    projectLabel:                  { en: 'Project:',                     zh: '项目：' },
    modeLabel:                     { en: 'Mode:',                        zh: '模式：' },
    archLabel:                     { en: 'Arch:',                        zh: '架构：' },
    runAtLabel:                    { en: 'Run at:',                      zh: '执行端：' },
    kind:                          { en: 'Kind:',                        zh: '类型：' },
    // status diagnostics
    noActiveTarget:                { en: 'No active target selected',    zh: '未选择活动目标' },
    notInitialized:                { en: 'Not initialized, no config found', zh: '未初始化，未找到配置' },
    statusSetupLocal:              { en: 'local setup',                     zh: '本地初始化' },
    statusSetupRemote:             { en: 'local + remote setup',            zh: '本地 + 远程初始化' },
    noSyncServer:                  { en: 'No sync server added',         zh: '未添加同步服务器' },
    noSyncServerHint:              { en: 'Configure sync server with forja sync', zh: '使用 forja sync 配置同步服务器' },
    remotePathNotConfigured:       { en: 'Remote path not configured',   zh: '远程路径未配置' },
    remoteNoServer:                { en: 'runAt=remote but no server configured', zh: '执行位置=远程但未配置服务器' },
    remoteForjaBinDefault:         { en: 'Remote Forja bin not configured, will use default: $HOME/.forja/bin/forja', zh: '远程 Forja 二进制未配置，将使用默认值：$HOME/.forja/bin/forja' },
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
    installVsSdk:                  { en: 'Install Visual Studio and configure with forja setup --vs-dev-cmd', zh: '安装 Visual Studio 并用 forja setup --vs-dev-cmd 配置' },
    installBuildEssential:         { en: 'Install build-essential or equivalent', zh: '安装 build-essential 或同等工具' },
    deployRemote:                  { en: 'Run forja doctor fix --remote to deploy, or configure with forja remote forja-bin --path <path>', zh: '运行 forja doctor fix --remote 部署，或用 forja remote forja-bin --path <path> 配置' },
    langMissingValue:              { en: 'Language required: zh or en. View current: forja list lang', zh: '请指定语言: zh 或 en。查看当前语言: forja list lang' },
    // list
    targets:                       { en: 'Targets',                      zh: '目标' },
    servers:                       { en: 'Servers',                      zh: '服务器' },
    environment:                   { en: 'Environment',                  zh: '环境' },
    remoteConfiguration:           { en: 'Remote Configuration',         zh: '远程配置' },
    workspaceMode:                 { en: 'Workspace mode:',              zh: '工作区模式：' },
    remoteWorkspace:               { en: 'Remote workspace:',            zh: '远程工作区：' },
    forjaBin:                      { en: 'Forja bin:',                   zh: 'Forja 二进制：' },
    buildOrder:                    { en: 'Build order:',                 zh: '构建顺序：' },
    transfer:                      { en: 'Transfer:',                    zh: '传输：' },
    repos:                         { en: 'Repos:',                       zh: '仓库：' },
    project:                       { en: 'project:',                     zh: '项目：' },
    mode:                          { en: 'mode:',                        zh: '模式：' },
    arch:                          { en: 'arch:',                       zh: '架构：' },
    enabled:                       { en: 'enabled=',                     zh: '已启用=' },
    server:                        { en: 'server=',                      zh: '服务器=' },
    path:                          { en: 'path:',                        zh: '路径：' },
    baseline:                      { en: 'baseline:',                    zh: '基线：' },
    artifacts:                     { en: 'artifacts:',                   zh: '制品：' },
    strictHostKey:                 { en: 'StrictHostKey:',               zh: '严格主机密钥：' },
    // use
    updated:                       { en: 'updated',                      zh: '已更新' },
    target:                        { en: 'Target:',                      zh: '目标：' },
    profile:                       { en: 'Profile:',                     zh: '配置方案：' },
    // server
    serverAdded:                   { en: 'Server added',                 zh: '服务器已添加' },
    serverUpdated:                 { en: 'Server updated',               zh: '服务器已更新' },
    serverRemoved:                 { en: 'Server removed',               zh: '服务器已移除' },
    id:                            { en: 'ID:',                          zh: 'ID：' },
    name:                          { en: 'Name:',                        zh: '名称：' },
    host:                          { en: 'Host:',                        zh: '主机：' },
    port:                          { en: 'Port:',                        zh: '端口：' },
    username:                      { en: 'Username:',                    zh: '用户名：' },
    auth:                          { en: 'Auth:',                        zh: '认证：' },
    key:                           { en: 'Key:',                         zh: '密钥：' },
    // doctor
    doctor:                        { en: 'Doctor:',                      zh: '诊断：' },
    planDryRun:                    { en: 'Plan (dry run):',              zh: '计划（预演）：' },
    wouldWrite:                    { en: 'Would write:',                 zh: '将写入：' },
    wouldRun:                      { en: 'Would run:',                   zh: '将运行：' },
    commands:                      { en: 'Commands:',                    zh: '命令：' },
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
    'sync.notEnabled':             { en: 'Sync is not enabled',         zh: '远程同步未启用' },
    'sync.noRemotePath':           { en: 'Remote path not configured',  zh: '未配置远程路径' },
    'sync.noGitRepos':             { en: 'No git repositories found',   zh: '未找到 git 仓库' },
    'sync.filesNotFound':          { en: 'Specified files not found in any git root', zh: '指定文件在任何 git 仓库中均未找到' },
    'sync.passwordRequired':       { en: 'Password not provided. Set FORJA_SSH_PASSWORD or enter interactively', zh: '未提供密码。可通过环境变量 FORJA_SSH_PASSWORD 设置，或在 TTY 中交互输入' },
    'sync.passwordPrompt':         { en: 'Password for',                    zh: '输入' },
    'sync.ambiguous':              { en: 'matched multiple servers, use id', zh: '匹配到多个服务器，请使用 id' },
    'sync.createRemoteDirFailed':  { en: 'Create remote directory failed', zh: '创建远程目录失败' },
    'sync.resetDone':              { en: 'Sync state cleared; next sync will recalculate', zh: '已清除同步状态；下次同步会重新计算待同步文件' },
    'sync.resetConflict':          { en: 'cannot combine with',           zh: '不能与以下参数同时使用' },
    syncConfirm:                   { en: 'Proceed with sync?',          zh: '确认执行同步？' },
    syncCancelled:                 { en: 'Sync cancelled',              zh: '同步已取消' },
    syncNothing:                   { en: 'Nothing to sync',             zh: '没有需要同步的内容' },
    syncComplete:                  { en: 'Sync complete',                zh: '同步完成' },
    syncStateReset:                { en: 'Sync state reset',             zh: '同步状态已重置' },
    syncIgnore:                    { en: 'Ignore',                        zh: '忽略' },
    pending:                       { en: 'Pending',                      zh: '待同步' },
    uploaded:                      { en: 'Uploaded',                     zh: '已上传' },
    deleted:                       { en: 'Deleted',                      zh: '已删除' },
    skipped:                       { en: 'Skipped',                      zh: '已跳过' },
    // build/run/clean/stop
    build:                         { en: 'Build',                        zh: '构建' },
    buildSucceeded:                { en: 'succeeded',                    zh: '成功' },
    buildFailed:                   { en: 'failed',                       zh: '失败' },
    duration:                      { en: 'Duration:',                    zh: '耗时：' },
    errors:                        { en: 'Errors:',                      zh: '错误：' },
    warnings:                      { en: 'Warnings:',                    zh: '警告：' },
    run:                           { en: 'Run',                          zh: '运行' },
    runCompleted:                  { en: 'completed',                    zh: '已完成' },
    runFailed:                     { en: 'failed',                       zh: '失败' },
    pidLabel:                      { en: 'PID',                          zh: '进程ID' },
    clean:                         { en: 'Clean',                        zh: '清理' },
    cleanSucceeded:                { en: 'succeeded',                    zh: '成功' },
    cleanFailed:                   { en: 'failed',                       zh: '失败' },
    cleaned:                       { en: 'Cleaned:',                     zh: '已清理：' },
    state:                         { en: 'State:',                       zh: '状态：' },
    processStopped:                { en: 'Process stopped',              zh: '进程已停止' },
    noRunningProcess:              { en: 'No running process',           zh: '没有运行中的进程' },
    stopNotSupported:              { en: 'Stop not supported for this target', zh: '此目标不支持停止' },
    stopSdkUnsupported:            { en: 'SDK target does not support stop. SDK builds are not long-running.', zh: 'SDK 目标不支持停止。SDK 构建不是长运行进程。' },
    stopTerminateFailed:           { en: 'Failed to terminate process',  zh: '终止进程失败' },
    stopStillRunning:              { en: 'Process still running',        zh: '进程仍在运行' },
    // init
    initFailed:                    { en: 'Forja setup failed',           zh: 'Forja 初始化失败' },
    initPlan:                      { en: 'Forja setup plan (dry run)',   zh: 'Forja 初始化计划（预演）' },
    initSucceeded:                 { en: 'Forja setup succeeded',        zh: 'Forja 初始化成功' },
    initWillDetect:                { en: 'Will detect: Qt targets, SDK targets, toolchain paths', zh: '将检测：Qt 目标、SDK 目标、工具链路径' },
    initNotAutoSelecting:          { en: 'Not auto-selecting (multiple targets found)', zh: '未自动选择（找到多个目标）' },
    qtTargetSingular:              { en: 'Qt target',                    zh: 'Qt 目标' },
    qtTargetPlural:                { en: 'Qt targets',                   zh: 'Qt 目标' },
    sdkTargetSingular:             { en: 'SDK target',                   zh: 'SDK 目标' },
    sdkTargetPlural:               { en: 'SDK targets',                  zh: 'SDK 目标' },
    zeroTargets:                   { en: '0 targets',                    zh: '0 个目标' },
    toolchainNone:                 { en: 'none',                         zh: '无' },
    // list extras
    configuredMark:                { en: '[configured]',                 zh: '[已配置]' },
    serverIdLabel:                 { en: 'ID:',                          zh: 'ID：' },
    serverNameLabel:               { en: 'Name:',                        zh: '名称：' },
    serverHostLabel:               { en: 'Host:',                        zh: '主机：' },
    serverPortLabel:               { en: 'Port:',                        zh: '端口：' },
    serverUsernameLabel:           { en: 'Username:',                    zh: '用户名：' },
    serverAuthLabel:               { en: 'Auth:',                        zh: '认证：' },
    // list env labels
    qtLabel:                       { en: 'Qt:',                          zh: 'Qt：' },
    vsLabel:                       { en: 'VS:',                          zh: 'VS：' },
    jomLabel:                      { en: 'jom:',                         zh: 'jom：' },
    makeLabel:                     { en: 'make:',                        zh: 'make：' },
    roleLabel:                     { en: 'role:',                        zh: '角色：' },
    // setup labels
    setupTitle:                    { en: 'Forja Setup',                  zh: 'Forja 初始化' },
    setupLocal:                    { en: 'Local:',                       zh: '本地：' },
    setupRemote:                   { en: 'Remote:',                      zh: '远程：' },
    setupRemotePath:               { en: 'Remote path:',                 zh: '远程路径：' },
    setupSync:                     { en: 'Sync:',                        zh: '同步：' },
    setupForja:                    { en: 'Forja:',                       zh: 'Forja：' },
    setupConfigured:               { en: 'Configured',                   zh: '已配置' },
    setupConfigFailed:             { en: 'Configuration failed',         zh: '配置失败' },
    setupTargets:                  { en: 'targets',                      zh: '个目标' },
    setupEnabled:                  { en: 'enabled',                      zh: '已启用' },
    setupDisabled:                 { en: 'disabled',                     zh: '未启用' },
    setupStepLocalConfig:          { en: 'Local config',                 zh: '本地配置' },
    setupStepServer:               { en: 'Server',                       zh: '服务器' },
    setupStepRemoteConfig:         { en: 'Remote config',                zh: '远程配置' },
    setupStepSync:                 { en: 'Sync',                         zh: '同步' },
    setupStepDeploy:               { en: 'Deploy Forja',                 zh: '部署 Forja' },
    setupStepRemoteInit:           { en: 'Remote init',                  zh: '远程初始化' },
    setupStepExecSwitch:           { en: 'Execution switch',             zh: '切换执行' },
    setupConfirmRemote:            { en: 'Configure remote build environment?', zh: '是否配置远程构建环境？' },
    setupSkippedRemote:            { en: 'Remote setup skipped by user', zh: '用户跳过了远程配置' },
    setupRemoteTitle:              { en: 'Remote Setup', zh: '远程配置' },
    setupRemoteConfigured:         { en: 'Remote',                        zh: '远程' },
    setupAdvancedRemoteConfigured: { en: 'Advanced remote config saved',  zh: '高级远程配置已保存' },
    setupAdvancedRemoteFailed:     { en: 'Failed to save advanced remote config', zh: '保存高级远程配置失败' },
    setupRemoteConfigFailed:       { en: 'Failed to configure remote',    zh: '配置远程失败' },
    setupSyncEnabled:              { en: 'Sync enabled',                  zh: '同步已启用' },
    setupSyncConfigFailed:         { en: 'Failed to configure sync',      zh: '配置同步失败' },
    setupForjaAlreadyOnRemote:     { en: 'already on remote',             zh: '已在远程' },
    setupForjaDeployed:            { en: 'Forja deployed to remote',      zh: 'Forja 已部署到远程' },
    setupForjaNotFound:            { en: 'Could not find Forja CLI package to deploy', zh: '找不到可部署的 Forja CLI 包' },
    setupDeployFailed:             { en: 'Failed to deploy Forja',        zh: '部署 Forja 失败' },
    setupRemoteInitFailed:         { en: 'Remote init failed',            zh: '远程初始化失败' },
    setupSshError:                 { en: 'SSH error',                     zh: 'SSH 错误' },
    setupMultipleServers:          { en: 'servers found',                zh: '个服务器' },
    setupNoServer:                 { en: 'No server configured',          zh: '未配置服务器' },
    setupSpecifyServer:            { en: 'run interactively or configure with forja remote first', zh: '请在交互模式运行或先用 forja remote 配置' },
    setupSelectServer:             { en: 'Select a server:',                zh: '选择服务器：' },
    setupNoServerSelected:         { en: 'No server selected',              zh: '未选择服务器' },
    setupRemotePathPrompt:         { en: 'Remote path',                     zh: '远程路径' },
    setupSshUnreachable:           { en: 'SSH connectivity check failed', zh: 'SSH 连通性检查失败' },
    setupSshVerifyExisting:        { en: 'verifying existing setup', zh: '验证已有配置' },
    setupDefault:                  { en: 'default',                  zh: '默认' },
    setupRequired:                 { en: '(required)',               zh: '(必填)' },
    setupSteps:                    { en: 'Steps:',                   zh: '步骤：' },
    setupHostNeedsUsername:        { en: '--username is required when using --host', zh: '使用 --host 时必须指定 --username' },
    setupServerCreated:            { en: 'Server created',                zh: '已创建服务器' },
    setupServerCreateFailed:       { en: 'Failed to create server',       zh: '创建服务器失败' },
    setupPromptHost:               { en: 'Host address',                  zh: '主机地址' },
    setupPromptUsername:           { en: 'Username',                      zh: '用户名' },
    setupPromptPort:               { en: 'Port',                          zh: '端口' },
    setupPromptAuthMode:           { en: 'Auth mode',                     zh: '认证方式' },
    setupAuthKey:                  { en: 'Key',                           zh: '密钥' },
    setupAuthPassword:             { en: 'Password',                      zh: '密码' },
    setupPromptPrivateKey:         { en: 'Private key path',              zh: '私钥路径' },
    setupPromptPassword:           { en: 'Password',                      zh: '密码' },
    setupPromptName:               { en: 'Server name',                   zh: '服务器名称' },
    setupNeedsInput:               { en: 'Needs input — provide answers via --answers', zh: '需要输入 — 通过 --answers 提供答案' },
    setupAnswersLoadFailed:        { en: 'Failed to load answers file', zh: '加载答案文件失败' },
    setupQuestionTarget:           { en: 'Select target',                 zh: '选择目标' },
    setupQuestionQtPath:           { en: 'Qt path',                       zh: 'Qt 路径' },
    setupQuestionVsInstall:        { en: 'VS install',                    zh: 'VS 安装' },
    setupQuestionMode:             { en: 'Build mode',                    zh: '构建模式' },
    setupQuestionArch:             { en: 'Target arch',                   zh: '目标架构' },
    // sync extras
    serverLabel:                   { en: 'Server:',                      zh: '服务器：' },
    remotePathLabel:               { en: 'Remote path:',                 zh: '远程路径：' },
    // doctor level
    levelError:                    { en: 'error',                        zh: '错误' },
    levelWarning:                  { en: 'warning',                      zh: '警告' },
    // doctor checks
    doctorActiveTarget:            { en: 'Active target',                zh: '活动目标' },
    doctorProjectMissing:          { en: 'Project file missing',         zh: '项目文件缺失' },
    doctorNoTarget:                { en: 'No active target selected',    zh: '未选择活动目标' },
    doctorQtPath:                  { en: 'Qt path',                      zh: 'Qt 路径' },
    doctorQtInvalid:               { en: 'Qt path invalid',              zh: 'Qt 路径无效' },
    doctorQtNotConfigured:         { en: 'Qt not configured',            zh: 'Qt 未配置' },
    doctorVsPath:                  { en: 'VS path',                      zh: 'VS 路径' },
    doctorVsInvalid:               { en: 'VS path invalid',              zh: 'VS 路径无效' },
    doctorVsNotConfigured:         { en: 'VS not configured',            zh: 'VS 未配置' },
    doctorJomPath:                 { en: 'jom path',                     zh: 'jom 路径' },
    doctorJomInvalid:              { en: 'jom path invalid',             zh: 'jom 路径无效' },
    doctorMakePath:                { en: 'make path',                    zh: 'make 路径' },
    doctorMakeNotFound:            { en: 'make not found',               zh: '未找到 make' },
    doctorSyncRemote:              { en: 'Sync remote path not configured', zh: '同步远程路径未配置' },
    doctorSyncDeleted:             { en: 'Sync server deleted',          zh: '同步服务器已删除' },
    doctorSyncNotConfigured:       { en: 'Sync not configured',          zh: '同步未配置' },
    doctorNoServer:                { en: 'No server configured for remote', zh: '未配置远程服务器' },
    doctorForjaBinNotConfigured:   { en: 'Remote Forja bin not configured', zh: '远程 Forja 二进制未配置' },
    doctorStaleConfigs:            { en: 'Found stale config(s)',        zh: '发现过期配置' },
    doctorNoStaleConfigs:          { en: 'No stale configs found',       zh: '无过期配置' },
    doctorRemoteNotConfigured:     { en: 'Remote not configured',        zh: '远程未配置' },
    doctorLockReleased:            { en: 'Lock released',                zh: '锁已释放' },
    doctorLockFailed:              { en: 'Remote unlock failed',         zh: '远程解锁失败' },
    doctorRestored:                { en: 'Restored',                     zh: '已恢复' },
    doctorRestoreFailed:           { en: 'Remote restore failed',        zh: '远程恢复失败' },
    doctorResetDone:               { en: 'Reset',                        zh: '已重置' },
    doctorResetFailed:             { en: 'Remote reset failed',          zh: '远程重置失败' },
    doctorCleanDone:               { en: 'Cleaned untracked',            zh: '已清理未跟踪文件' },
    doctorCleanFailed:             { en: 'Remote clean-untracked failed', zh: '远程清理失败' },
    paths:                         { en: 'path(s) in',                   zh: '个路径，仓库' },
    // doctor actions
    doctorActionCheck:             { en: 'check',                        zh: '检查' },
    doctorActionFix:               { en: 'fix',                          zh: '修复' },
    doctorActionUnlock:            { en: 'unlock',                       zh: '解锁' },
    doctorActionRestore:           { en: 'restore',                      zh: '恢复' },
    doctorActionReset:             { en: 'reset',                        zh: '重置' },
    doctorActionCleanUntracked:    { en: 'clean-untracked',              zh: '清理未跟踪' },
    // doctor check names
    doctorCheckTarget:             { en: 'target',                       zh: '目标' },
    doctorCheckToolchainQt:        { en: 'toolchain-qt',                 zh: 'Qt工具链' },
    doctorCheckToolchainVs:        { en: 'toolchain-vs',                 zh: 'VS工具链' },
    doctorCheckToolchainJom:       { en: 'toolchain-jom',                zh: 'jom工具链' },
    doctorCheckToolchainMake:      { en: 'toolchain-make',               zh: 'make工具链' },
    doctorCheckSync:               { en: 'sync',                         zh: '同步' },
    doctorCheckRemote:             { en: 'remote',                       zh: '远程' },
    doctorCheckRemoteForja:        { en: 'remote-forja',                 zh: '远程Forja' },
    doctorCheckCleanup:            { en: 'cleanup',                      zh: '清理' },
    doctorCheckUnlock:             { en: 'unlock',                       zh: '解锁' },
    doctorCheckRestore:            { en: 'restore',                      zh: '恢复' },
    doctorCheckReset:              { en: 'reset',                        zh: '重置' },
    doctorCheckCleanUntracked:     { en: 'clean-untracked',              zh: '清理未跟踪' },
    // help texts
    'help.toplevel': {
        en: 'Usage: forja <command> [action] [options]\n\nCommands:\n  status     Show workspace readiness\n  setup      One-stop initialization (local + remote)\n  list       List targets, servers, repos, env, config\n  use        Select target and execution mode\n  server     Manage remote servers (add/update/remove)\n  remote     Manage remote configuration\n  build      Build the active target\n  run        Run the built application\n  stop       Stop a running application\n  clean      Clean build artifacts\n  doctor     Deep diagnostics and recovery\n  sync       Sync files with remote server\n\nGlobal options:\n  --help, -h       Show help\n  --version, -v    Show version\n  --json           JSON output\n  --lang <locale>  Language: zh or en\n  --workspace <p>  Specify workspace (default: cwd)',
        zh: '用法: forja <命令> [动作] [选项]\n\n命令:\n  status     查看工作区就绪状态\n  setup      一站式初始化（本地 + 远程）\n  list       列出目标、服务器、仓库、环境、配置\n  use        选择目标和执行模式\n  server     管理远程服务器（添加/更新/删除）\n  remote     管理远程配置\n  build      构建当前目标\n  run        运行已构建的应用\n  stop       停止运行中的应用\n  clean      清理构建产物\n  doctor     深度诊断与修复\n  sync       与远程服务器同步文件\n\n全局选项:\n  --help, -h       显示帮助\n  --version, -v    显示版本\n  --json           JSON 输出\n  --lang <locale>  语言: zh 或 en\n  --workspace <p>  指定工作区（默认当前目录）',
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
    'help.setup': {
        en: `Usage:
  forja setup [options]              Local initialization
  forja setup remote [options]       Remote initialization

Options (local):
  --json                  Output as JSON
  --reset                 Force reconfiguration
  --answers <path>        Load answers from JSON file
  --project <path>        Select specific target
  --qt-path <path>        Qt installation path
  --vs-install <path>     Visual Studio installation path
  --jom-path <path>       jom executable path
  --mode <debug|release>  Build mode
  --arch <x86|x64>        Target architecture

Options (remote):
  --json                  Output as JSON
  --reset                 Force reconfiguration
  --answers <path>        Load answers from JSON file
  --project <path>        Select specific target
  --qt-path <path>        Qt installation path
  --vs-install <path>     Visual Studio installation path
  --jom-path <path>       jom executable path
  --host <hostname>       Remote server hostname
  --username <user>       Remote username
  --port <number>         SSH port (default: 22)
  --auth-mode <key|password>  Authentication mode
  --private-key-path <path>   Private key path
  --name <name>           Server name
  --remote-path <path>    Remote workspace path
  --mode <debug|release>  Build mode
  --arch <x86|x64>        Target architecture`,
        zh: `用法:
  forja setup [选项]              本地初始化
  forja setup remote [选项]       远程初始化

选项（本地）:
  --json                  JSON 格式输出
  --reset                 强制重新配置
  --answers <路径>        从 JSON 文件加载答案
  --project <路径>        选择指定目标
  --qt-path <路径>        Qt 安装路径
  --vs-install <路径>     Visual Studio 安装路径
  --jom-path <路径>       jom 可执行文件路径
  --mode <debug|release>  构建模式
  --arch <x86|x64>        目标架构

选项（远程）:
  --json                  JSON 格式输出
  --reset                 强制重新配置
  --answers <路径>        从 JSON 文件加载答案
  --project <路径>        选择指定目标
  --qt-path <路径>        Qt 安装路径
  --vs-install <路径>     Visual Studio 安装路径
  --jom-path <路径>       jom 可执行文件路径
  --host <主机名>         远程服务器主机名
  --username <用户名>     远程用户名
  --port <端口号>         SSH 端口（默认：22）
  --auth-mode <key|password>  认证模式
  --private-key-path <路径>   私钥路径
  --name <名称>           服务器名称
  --remote-path <路径>    远程工作区路径
  --mode <debug|release>  构建模式
  --arch <x86|x64>        目标架构`,
    },
    'help.list': {
        en: `Usage:
  forja list targets               List project targets
  forja list env                   List all environment tools
  forja list env <qt|vs|jom|make>  List specific environment tool
  forja list lang                  List current language

Options:
  --json                  Output as JSON`,
        zh: `用法:
  forja list targets               列出项目目标
  forja list env                   列出所有环境工具
  forja list env <qt|vs|jom|make>  列出指定环境工具
  forja list lang                  列出当前语言

选项:
  --json                  JSON 格式输出`,
    },
    'help.use': {
        en: 'Usage: forja use <subcommand> [options] [--json]\n\nSubcommands:\n  target [--project <path>] [--mode <debug|release>] [--arch <x86|x64>]\n  execution --local | --remote\n  lang <zh|en>',
        zh: '用法: forja use <子命令> [选项] [--json]\n\n子命令:\n  target [--project <路径>] [--mode <debug|release>] [--arch <x86|x64>]\n  execution --local | --remote\n  lang <zh|en>',
    },
    'help.server': {
        en: 'Usage: forja server <add|update|remove> [options] [--json]',
        zh: '用法: forja server <add|update|remove> [选项] [--json]',
    },
    'help.remote': {
        en: 'Usage: forja remote <action> [options] [--json]\n\nActions:\n  show                                        Show remote configuration\n  set --server <name> [--remote-path <path>]  Set remote server and path\n  workspace --mode <staged|legacy> [--path <path>]  Set workspace mode and path\n  repo --local <name> --remote <name> --role <role>  Map local to remote repo\n  forja-bin --path <path> | --clear           Set remote Forja binary path\n  build-order <qt:build sdk:rebuild ...>       Set build order\n  transfer --server <name> --path <path> --artifact <path>  Configure transfer\n  restore                                     Restore remote workspace\n  reset                                       Reset remote workspace',
        zh: '用法: forja remote <动作> [选项] [--json]\n\n动作:\n  show                                        显示远程配置\n  set --server <名称> [--remote-path <路径>]  设置远程服务器和路径\n  workspace --mode <staged|legacy> [--path <路径>]  设置工作区模式和路径\n  repo --local <名称> --remote <名称> --role <角色>  映射本地到远程仓库\n  forja-bin --path <路径> | --clear           设置远程 Forja 二进制路径\n  build-order <qt:build sdk:rebuild ...>       设置构建顺序\n  transfer --server <名称> --path <路径> --artifact <路径>  配置传输\n  restore                                     恢复远程工作区\n  reset                                       重置远程工作区',
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
  --json                  JSON 格式输出
  --lang <locale>         语言: zh 或 en
  --workspace <路径>      工作区目录（默认当前目录）`,
    },
    'help.run': {
        en: 'Usage: forja run [designer <ui-file>] [--detach] [--debug] [--custom <cmd>] [--plan] [--json]',
        zh: '用法: forja run [designer <ui文件>] [--detach] [--debug] [--custom <命令>] [--plan] [--json]',
    },
    'help.stop': {
        en: 'Usage: forja stop [--json]',
        zh: '用法: forja stop [--json]',
    },
    'help.clean': {
        en: 'Usage: forja clean [--plan] [--json]',
        zh: '用法: forja clean [--plan] [--json]',
    },
    'help.doctor': {
        en: 'Usage: forja doctor [check|fix|unlock] [--remote] [--force] [--json]',
        zh: '用法: forja doctor [check|fix|unlock] [--remote] [--force] [--json]',
    },
    'help.sync': {
        en: `Usage:
  forja sync                                        Sync changed files (interactive confirm)
  forja sync --yes                                  Skip confirmation
  forja sync --reset                                Clear sync state
  forja sync plan                                   Preview pending changes
  forja sync status                                 Show sync configuration
  forja sync --file <path>                          Sync specific file (repeatable)

Options:
  --json                                  JSON output`,
        zh: `用法:
  forja sync                                        同步变更文件（交互确认）
  forja sync --yes                                  跳过确认
  forja sync --reset                                清除同步状态
  forja sync plan                                   预览待同步文件
  forja sync status                                 查看同步配置
  forja sync --file <路径>                          同步指定文件（可重复）

选项:
  --json                                  JSON 格式输出`,
    },
    // init diagnostics
    'init.workspaceNotFound':            { en: 'Workspace does not exist',            zh: '工作区不存在' },
    'init.projectNotFound':              { en: 'Project not found in workspace',      zh: '工作区中未找到项目' },
    'init.invalidMode':                  { en: 'Invalid build mode',                    zh: '无效的构建模式' },
    'init.invalidArch':                  { en: 'Invalid target architecture',           zh: '无效的目标架构' },
    'init.foundQtSdkNotAutoSelecting':   { en: 'Found Qt and SDK targets, not auto-selecting', zh: '找到 Qt 和 SDK 目标，未自动选择' },
    'init.foundTargetsNotAutoSelecting': { en: 'Found targets, not auto-selecting',          zh: '找到多个目标，未自动选择' },
    'init.noTargetsToolchainOnly':       { en: 'No Qt or SDK targets found, only toolchain defaults saved', zh: '未找到 Qt 或 SDK 目标，仅保存了工具链默认值' },
    'init.qtMissing':                    { en: 'Qt installation not detected',        zh: '未检测到 Qt 安装' },
    'init.vsMissing':                    { en: 'Visual Studio installation not detected', zh: '未检测到 Visual Studio 安装' },
    'init.jomMissing':                   { en: 'jom not detected (optional, recommended for faster Qt builds on Windows)', zh: '未检测到 jom（可选，建议安装以加速 Windows 上的 Qt 构建）' },
    'init.makeMissing':                  { en: 'make not detected',                   zh: '未检测到 make' },
    'init.configAlreadyExists':          { en: 'Configuration already exists, only filling missing items', zh: '配置已存在，仅补充缺失项' },
    'init.selectTarget':                 { en: 'Select a target project', zh: '选择目标项目' },
    'init.skipSelection':                { en: 'Skip (select later)',      zh: '跳过（稍后选择）' },
    'init.remoteNoServer':               { en: 'Remote init requested but no server configured', zh: '请求了远程初始化但未配置服务器' },
    'init.serverNotFound':               { en: 'Server not found',                    zh: '服务器未找到' },
    'init.remotePathMissing':            { en: 'No remote path configured for server', zh: '服务器未配置远程路径' },
    'init.noLocalTargetsSkipRemote':     { en: 'No local targets detected; skipping remote bridge init. Use `forja use target` first.', zh: '未检测到本地目标；跳过远程桥接初始化。请先使用 `forja use target`。' },
    'init.remoteInitFailed':            { en: 'Remote init failed',                  zh: '远程初始化失败' },
    'init.remoteInitSucceeded':         { en: 'Remote init succeeded',               zh: '远程初始化成功' },
    'init.configWriteFailed':           { en: 'Failed to write configuration',       zh: '写入配置失败' },
    // index.ts dispatcher messages
    'idx.noCommand':                    { en: 'No command specified. Run `forja --help` for usage.', zh: '未指定命令。运行 `forja --help` 查看用法。' },
    'idx.unknownCommand':               { en: 'Unknown command',                    zh: '未知命令' },
    'idx.unknownFlags':                 { en: 'Unknown flag(s)',                    zh: '未知参数' },
    'idx.listCategoryRequired':         { en: 'Category required. Usage: forja list <targets|env|lang>', zh: '需要指定分类。用法: forja list <targets|env|lang>' },
    'idx.unknownListCategory':          { en: 'Unknown list category',              zh: '未知列表分类' },
    'idx.validCategories':              { en: 'Valid categories',                   zh: '有效分类' },
    'idx.unknownEnvSubcategory':        { en: 'Unknown env subcategory',           zh: '未知环境子分类' },
    'idx.unknownUseSubcommand':         { en: 'Unknown use subcommand',             zh: '未知 use 子命令' },
    'idx.useUsage':                     { en: 'Usage: forja use <target|execution|lang> [options]', zh: '用法: forja use <target|execution|lang> [选项]' },
    'idx.invalidPort':                  { en: 'Invalid port',                       zh: '无效端口' },
    'idx.invalidPortHint':              { en: 'Must be a number between 1 and 65535.', zh: '必须是 1 到 65535 之间的数字。' },
    'idx.unknownServerSubcommand':      { en: 'Unknown server subcommand',          zh: '未知 server 子命令' },
    'idx.unknownRemoteSubcommand':      { en: 'Unknown remote subcommand',          zh: '未知 remote 子命令' },
    'idx.unknownBuildAction':           { en: 'Unknown build action',               zh: '未知构建动作' },
    'idx.validActions':                 { en: 'Valid actions: fresh, qmake, rcc',   zh: '有效动作: fresh, qmake, rcc' },
    'idx.runDesignerUsage':             { en: 'Usage: forja run designer <ui-file>', zh: '用法: forja run designer <ui文件>' },
    'idx.unknownArgument':              { en: 'Unknown argument',                   zh: '未知参数' },
    'idx.runDesignerHint':              { en: "Use 'forja run designer <ui-file>' for UI designer.", zh: '使用 \'forja run designer <ui文件>\' 打开 UI 设计器。' },
    'idx.unexpectedArgument':           { en: 'Unexpected argument',                zh: '意外参数' },
    'idx.didYouMean':                   { en: 'Did you mean',                       zh: '你是否想' },
    // server diagnostics
    'srv.missingName':                  { en: 'Missing required: --name',           zh: '缺少必填参数：--name' },
    'srv.missingHost':                  { en: 'Missing required: --host',           zh: '缺少必填参数：--host' },
    'srv.missingUsername':              { en: 'Missing required: --username',       zh: '缺少必填参数：--username' },
    'srv.keyRequiresKeyOrPassword':     { en: 'auth-mode=key requires --private-key-path or password', zh: 'auth-mode=key 需要 --private-key-path 或 password' },
    'srv.passwordRequiresPassword':     { en: 'auth-mode=password requires --password', zh: 'auth-mode=password 需要 --password' },
    'srv.failedToSave':                 { en: 'Failed to save',                     zh: '保存失败' },
    'srv.serverNotFound':               { en: 'Server not found',                   zh: '服务器未找到' },
    // status diagnostics
    'sts.workspaceNotFound':            { en: 'Workspace does not exist',           zh: '工作区不存在' },
    'sts.configCorrupted':              { en: 'Config file parse failed',               zh: '配置文件解析失败' },
    'sts.configCorruptedHint':           { en: 'File may be corrupted, delete and re-run forja setup', zh: '文件可能已损坏，请删除后重新运行 forja setup' },
    'sts.projectFileMissing':           { en: 'Project file does not exist',        zh: '项目文件不存在' },
    'sts.failedToReadRunState':         { en: 'Failed to read run state',           zh: '读取运行状态失败' },
    'sts.forjaStatus':                  { en: 'Forja status',                       zh: 'Forja 状态' },
    'sts.makefileMismatch':             { en: 'Makefile does not match current config', zh: 'Makefile 与当前配置不匹配' },
    'sts.makefileMismatchHint':         { en: 'Re-run qmake to regenerate Makefile', zh: '重新运行 qmake 以重新生成 Makefile' },
    'sts.targetsFound':                 { en: 'Found {0} Qt and {1} SDK targets, none selected', zh: '找到 {0} 个 Qt 和 {1} 个 SDK 目标，未选择' },
    'sts.syncServerNotFound':           { en: 'Sync server "{0}" does not exist', zh: '同步服务器 "{0}" 不存在' },
    'sts.syncServerMissing':            { en: 'server not found',                  zh: '服务器未找到' },
    'sts.syncNotEnabled':               { en: 'Sync not configured; use forja setup remote for remote builds', zh: '同步未配置，远程构建可用 forja setup remote 配置' },
    // list diagnostics
    'lst.qtPathNotConfigured':          { en: 'Qt path not configured',             zh: 'Qt 路径未配置' },
    'lst.vsInstallNotConfigured':       { en: 'VS install not configured',          zh: 'VS 安装未配置' },
    'lst.serverNotFound':               { en: 'Server not found',                   zh: '服务器未找到' },
    // use diagnostics
    'use.workspaceNotFound':             { en: 'Workspace does not exist',          zh: '工作区不存在' },
    'use.invalidMode':                   { en: 'Invalid mode',                      zh: '无效模式' },
    'use.invalidModeDetail':             { en: 'Must be debug or release',          zh: '必须为 debug 或 release' },
    'use.invalidArch':                   { en: 'Invalid arch',                      zh: '无效架构' },
    'use.invalidArchDetail':             { en: 'Must be x86 or x64',               zh: '必须为 x86 或 x64' },
    'use.projectNotFound':              { en: 'Project file not found',            zh: '项目文件未找到' },
    'use.projectOutsideWorkspace':       { en: 'Project is outside the workspace',  zh: '项目在工作区之外' },
    'use.cannotDetermineKind':           { en: 'Cannot determine project kind from', zh: '无法从以下路径确定项目类型' },
    'use.expectedExtensions':            { en: 'Expected .pro, .sln, Makefile, or CMakeLists.txt',  zh: '期望 .pro、.sln、Makefile 或 CMakeLists.txt' },
    'use.failedToSaveActiveTarget':      { en: 'Failed to save activeTarget',       zh: '保存活动目标失败' },
    'use.failedToSaveExecMode':          { en: 'Failed to save execution mode',     zh: '保存执行模式失败' },
    'use.cannotSpecifyBothLocalRemote':  { en: 'Cannot specify both --local and --remote', zh: '不能同时指定 --local 和 --remote' },
    'use.mustSpecifyLocalOrRemote':      { en: 'Must specify --local or --remote',  zh: '必须指定 --local 或 --remote' },
    'use.noActiveTargetSelected':        { en: 'No active target selected',         zh: '未选择活动目标' },
    'use.cannotSpecifyBothEnableDisable':{ en: 'Cannot specify both --enable and --disable', zh: '不能同时指定 --enable 和 --disable' },
    'use.serverNotFound':                { en: 'Server not found',                  zh: '服务器未找到' },
    'use.ambiguousServerName':           { en: 'Ambiguous server name',              zh: '服务器名称不明确' },
    'use.useServerIdInstead':            { en: 'Use server ID instead',              zh: '请改用服务器 ID' },
    'use.remotePathRequired':            { en: 'Remote path required when specifying server', zh: '指定服务器时需要远程路径' },
    'use.noServerConfigured':            { en: 'No server configured. Use --server <name> first.', zh: '未配置服务器。请先使用 --server <name>。' },
    'use.workspaceSetRequiresMode':      { en: 'workspace set requires --mode',      zh: 'workspace set 需要 --mode' },
    'use.repoSetRequires':               { en: 'repo set requires --local, --remote, and --role', zh: 'repo set 需要 --local、--remote 和 --role' },
    'use.invalidLocalRepoName':          { en: 'Invalid local repo name',            zh: '无效的本地仓库名' },
    'use.invalidRemoteRepoName':         { en: 'Invalid remote repo name',           zh: '无效的远程仓库名' },
    'use.repoRemoveRequiresLocal':       { en: 'repo remove requires --local',       zh: 'repo remove 需要 --local' },
    'use.forjaBinSetRequiresPath':       { en: 'forja-bin set requires --path',      zh: 'forja-bin set 需要 --path' },
    'use.buildOrderRequiresItem':        { en: 'build-order set requires at least one item', zh: 'build-order set 至少需要一个条目' },
    'use.invalidActionFor':              { en: 'Invalid action for',                 zh: '无效动作' },
    'use.validActions':                  { en: 'Valid',                              zh: '有效值' },
    'use.transferSetRequiresServerPath': { en: 'transfer set requires --server and --path', zh: 'transfer set 需要 --server 和 --path' },
    'use.transferSetRequiresArtifact':   { en: 'transfer set requires at least one --artifact', zh: 'transfer set 至少需要一个 --artifact' },
    'use.qmakeTargetCannotBeEmpty':      { en: 'qmake-target cannot be empty',       zh: 'qmake-target 不能为空' },
    'use.invalidLanguage':               { en: 'Invalid language',                   zh: '无效语言' },
    'use.useZhOrEn':                     { en: 'Use zh or en',                       zh: '请使用 zh 或 en' },
    'use.failedToSaveLanguage':          { en: 'Failed to save language',             zh: '保存语言失败' },
    // build/run/clean/stop shared diagnostics
    'cmd.cannotDetermineKind':           { en: 'Cannot determine project kind from', zh: '无法从以下路径确定项目类型' },
    'cmd.projectNotFound':               { en: 'Project file not found',             zh: '项目文件未找到' },
    'cmd.targetProjectMissing':          { en: 'Target project missing',             zh: '目标项目缺失' },
    'cmd.sdkNoQmakeRcc':                 { en: 'SDK target does not support',        zh: 'SDK 目标不支持' },
    'cmd.rccNotRemote':                  { en: 'RCC is not supported on remote targets', zh: 'RCC 不支持远程目标' },
    'cmd.sdkBuildFailed':                { en: 'SDK build failed',                   zh: 'SDK 构建失败' },
    'cmd.qtBuildFailed':                 { en: 'Qt build failed',                    zh: 'Qt 构建失败' },
    'cmd.sdkRunUnsupported':             { en: 'SDK target does not support run. Build first.', zh: 'SDK 目标不支持运行。请先构建。' },
    'cmd.debugVscodeOnly':               { en: 'Debug is only available in VSCode. Use the "Forja: Debug" command from the Command Palette, or click the debug button in the status bar.', zh: '调试仅在 VSCode 中可用。使用命令面板中的 "Forja: Debug" 命令，或点击状态栏中的调试按钮。' },
    'cmd.sdkCustomUnsupported':          { en: 'SDK target does not support custom commands', zh: 'SDK 目标不支持自定义命令' },
    'cmd.customNotFound':                { en: 'Custom command not found',           zh: '自定义命令未找到' },
    'cmd.customFailed':                  { en: 'Custom command failed',              zh: '自定义命令失败' },
    'cmd.qtRunFailed':                   { en: 'Qt run failed',                      zh: 'Qt 运行失败' },
    'cmd.targetNotSelected':             { en: 'Target not selected',                zh: '目标未选择' },
    'cmd.sdkCleanFailed':                { en: 'SDK clean failed',                   zh: 'SDK 清理失败' },
    'cmd.qtCleanFailed':                 { en: 'Qt clean failed',                    zh: 'Qt 清理失败' },
    'cmd.stopFailedDetail':              { en: 'Failed to terminate process',        zh: '终止进程失败' },
    'cmd.stopStillRunningDetail':        { en: 'Process still running',              zh: '进程仍在运行' },
    'cmd.freshCleanFailed':              { en: 'Clean step of fresh build failed',   zh: '完全重建的清理步骤失败' },
    'cmd.noActiveTarget':                { en: 'No active target. Run `forja setup` or `forja use target --project <path>`.', zh: '未选择活动目标。运行 `forja setup` 或 `forja use target --project <path>`。' },
    'cmd.failedToSave':                  { en: 'Failed to save',                     zh: '保存失败' },
    'cmd.choosePrompt':                  { en: 'Select',                             zh: '请选择' },
    // sync help fix — actual supported usage
    'help.sync.actual': {
        en: `Usage:
  forja sync                                        Sync changed files (interactive confirm)
  forja sync --yes                                  Skip confirmation
  forja sync --reset                                Clear sync state
  forja sync plan                                   Preview pending changes
  forja sync status                                 Show sync configuration
  forja sync --file <path>                          Sync specific file (repeatable)

Options:
  --json                                  JSON output`,
        zh: `用法:
  forja sync                                        同步变更文件（交互确认）
  forja sync --yes                                  跳过确认
  forja sync --reset                                清除同步状态
  forja sync plan                                   预览待同步文件
  forja sync status                                 查看同步配置
  forja sync --file <路径>                          同步指定文件（可重复）

选项:
  --json                                  JSON 格式输出`,
    },
    // server help — document no-arg list behavior
    'help.server.full': {
        en: 'Usage: forja server [<add|update|remove>] [options] [--json]\n\n  forja server                  List all servers\n  forja server add              Add a new server\n  forja server update <id>      Update an existing server\n  forja server remove <id>      Remove a server',
        zh: '用法: forja server [<add|update|remove>] [选项] [--json]\n\n  forja server                  列出所有服务器\n  forja server add              添加新服务器\n  forja server update <id>      更新已有服务器\n  forja server remove <id>      删除服务器',
    },
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
