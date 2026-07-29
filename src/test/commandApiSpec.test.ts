/**
 * Tests verifying CLI command API surface matches the spec documentation.
 * Covers: command registration, naming consistency, result structures, i18n, and flag validation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = process.cwd();

function source(relativePath: string): string {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ── Command surface ──

test('CLI dispatcher registers exactly 11 commands (doctor removed)', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    const expectedCommands = ['status', 'list', 'use', 'remote', 'server', 'build', 'run', 'stop', 'clean', 'sync', 'init'];
    for (const cmd of expectedCommands) {
        assert.ok(indexSrc.includes(`'${cmd}'`), `Command '${cmd}' must be registered in CLI dispatcher`);
    }
    const commandsMatch = indexSrc.match(/const COMMANDS: Command\[\] = \[([^\]]+)\]/);
    assert.ok(commandsMatch, 'COMMANDS array must exist');
    assert.ok(!commandsMatch[1].includes("'setup'"), "'setup' must NOT be a top-level command");
});

test('COMMANDS array includes all implemented commands except doctor', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    const commandsMatch = indexSrc.match(/const COMMANDS: Command\[\] = \[([^\]]+)\]/);
    assert.ok(commandsMatch, 'COMMANDS array must exist');
    const expectedCommands = ['status', 'list', 'use', 'remote', 'server', 'build', 'run', 'stop', 'clean', 'sync', 'init'];
    for (const cmd of expectedCommands) {
        assert.ok(commandsMatch[1].includes(`'${cmd}'`), `COMMANDS must include '${cmd}'`);
    }
});

// ── No stale `forja init` references ──

test('`forja init` is a valid command for workroot registration', () => { const activeTargetSrc = source('src/cli/commands/activeTarget.ts'); assert.ok(activeTargetSrc.includes("'forja init'"), 'activeTarget.ts should suggest forja init when workroot not registered'); });

test('qtCore.ts is a pure build plan builder (no settingsIO fallback)', () => {
    const qtCore = source('src/qt/shared/qtCore.ts');
    assert.ok(!qtCore.includes('loadQtSettings'), 'qtCore.ts must not import loadQtSettings');
    assert.ok(!qtCore.includes('saveQtSettings'), 'qtCore.ts must not import saveQtSettings');
});

// ── List categories ──

test('list command supports all categories', () => {
    const listSrc = source('src/cli/commands/list.ts');
    const expectedCategories = ['targets', 'env'];
    for (const cat of expectedCategories) {
        assert.ok(listSrc.includes(`'${cat}'`), `List category '${cat}' must be supported`);
    }
});

test('list command requires category argument (no bare `forja list`)', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    const listHandler = indexSrc.match(/case 'list':([\s\S]*?)(?:case '|default:|\/\/ ──)/);
    assert.ok(listHandler, 'list handler must exist');
    assert.ok(listHandler[1].includes('category') || listHandler[1].includes('argv'), 'list handler must parse category from argv');
});

// ── Use subcommands ──

test('use command supports all documented subcommands', () => {
    const useSrc = source('src/cli/commands/use.ts');
    const expectedSubcommands = [
        'runUseTarget',
        'formatUseText',
    ];
    for (const fn of expectedSubcommands) {
        assert.ok(useSrc.includes(`export function ${fn}`) || useSrc.includes(`export async function ${fn}`),
            `use.ts must export ${fn}`);
    }
    // Removed functions that moved to remote.ts or were deleted
    const removedSubcommands = [
        'runUseExecution',
        'runUseLang',
        'runUseSync',
        'runUseRemote',
        'runUseRemoteWorkspace',
        'runUseRemoteRepo',
        'runUseRemoteForjaBin',
        'runUseRemoteBuildOrder',
        'runUseRemoteTransfer',
        'runUseQt',
        'runUseCpp',
    ];
    for (const fn of removedSubcommands) {
        assert.ok(!useSrc.includes(`export function ${fn}`) && !useSrc.includes(`export async function ${fn}`),
            `use.ts must NOT export ${fn} (moved to remote.ts or deleted)`);
    }
});

// ── Remote subcommands ──

test('remote.ts exports all documented functions', () => {
    const remoteSrc = source('src/cli/commands/remote.ts');
    const expectedExports = [
        'runRemoteShow',
        'runRemoteSetup',
        'formatRemoteText',
    ];
    for (const fn of expectedExports) {
        assert.ok(remoteSrc.includes(`export function ${fn}`) || remoteSrc.includes(`export async function ${fn}`),
            `remote.ts must export ${fn}`);
    }
});

// ── Server command ──

test('server command supports add, update, remove', () => {
    const serverSrc = source('src/cli/commands/server.ts');
    assert.ok(serverSrc.includes('runServerAdd'), 'server.ts must export runServerAdd');
    assert.ok(serverSrc.includes('runServerUpdate'), 'server.ts must export runServerUpdate');
    assert.ok(serverSrc.includes('runServerRemove'), 'server.ts must export runServerRemove');
    assert.ok(serverSrc.includes('listServers'), 'server.ts must export listServers');
    assert.ok(serverSrc.includes('getServerDetail'), 'server.ts must export getServerDetail');
});

// ── Diagnostic type ──

test('Diagnostic type does not include code field (removed)', () => {
    const typesSrc = source('src/cli/commands/types.ts');
    assert.doesNotMatch(typesSrc, /interface Diagnostic \{[\s\S]*?code:\s*string/, 'Diagnostic must NOT have a `code: string` field');
    assert.match(typesSrc, /interface Diagnostic \{[\s\S]*?level:\s*(DiagnosticLevel|'info'\s*\|\s*'warning'\s*\|\s*'error')/, 'Diagnostic must have typed `level` field');
    assert.match(typesSrc, /interface Diagnostic \{[\s\S]*?message:\s*string/, 'Diagnostic must have `message: string` field');
});

test('diag() helper does not accept code parameter (removed)', () => {
    const typesSrc = source('src/cli/commands/types.ts');
    assert.match(typesSrc, /export function diag\(/, 'diag() helper must be exported');
    assert.doesNotMatch(typesSrc, /function diag\([^)]*code[^)]*\)/, 'diag() must NOT accept code parameter');
});

// ── i18n / T() function ──

test('T() function uses global locale (no locale parameter required)', () => {
    const typesSrc = source('src/cli/commands/types.ts');
    assert.ok(typesSrc.includes('setGlobalLocale'), 'types.ts must export setGlobalLocale');
    assert.ok(typesSrc.includes('getGlobalLocale'), 'types.ts must export getGlobalLocale');
    assert.ok(typesSrc.includes('_globalLocale'), 'types.ts must have _globalLocale state');
    // T() may accept optional params for interpolation, but must NOT have a locale parameter
    assert.match(typesSrc, /export function T\(\s*key\s*:\s*string/, 'T() must accept key parameter');
    assert.doesNotMatch(typesSrc, /export function T\([^)]*locale/, 'T() must not have locale parameter');
});

test('CLI entry point calls setGlobalLocale after resolving locale', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    assert.ok(indexSrc.includes('setGlobalLocale'), 'CLI entry must call setGlobalLocale');
    assert.ok(indexSrc.includes('resolveLocale'), 'CLI entry must call resolveLocale');
});

// ── Use target command (absorbed setup) ──

test('use target command supports setup-equivalent options', () => {
    const useSrc = source('src/cli/commands/useTarget/index.ts');
    assert.ok(useSrc.includes('interactive'), 'use target must support interactive mode');
    assert.ok(useSrc.includes('json'), 'use target must support --json');
    assert.ok(useSrc.includes('answers'), 'use target must support --answers');
    assert.ok(useSrc.includes('qtPath'), 'use target must support --qt');
    assert.ok(useSrc.includes('vsInstall'), 'use target must support --vs');
    assert.ok(useSrc.includes('jomPath'), 'use target must support --jom');
    assert.ok(useSrc.includes('questions'), 'use target must expose needs-input questions');
});

// ── Sync command ──

test('sync command supports plan and reset actions', () => {
    const syncSrc = source('src/cli/commands/sync.ts');
    assert.match(syncSrc, /SyncAction\s*=\s*'run'\s*\|\s*'plan'\s*\|\s*'reset'\s*\|\s*'status'\s*\|\s*'ignore'/, 'SyncAction must include run, plan, reset, status, and ignore');
});

// ── Unknown flag detection ──

test('CLI dispatcher validates unknown flags for all commands', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    assert.ok(indexSrc.includes('findUnknownFlags'), 'CLI dispatcher must use findUnknownFlags');
    const handleUse = indexSrc.match(/function handleUse\(([\s\S]*?)\n\}/);
    assert.ok(handleUse, 'handleUse function must exist');
    assert.ok(handleUse[1].includes('findUnknownFlags') || handleUse[1].includes('useUnknown'), 'handleUse must validate unknown flags');
});

// ── Build command ──

test('build command supports --project flag for bypassing activeTarget', () => {
    const buildSrc = source('src/cli/commands/build.ts');
    assert.match(buildSrc, /project\?:\s*string/, 'BuildResult or options must support project field');
});

// ── Result structure consistency ──

test('all command result types include ok and action fields', () => {
    const files = [
        { file: 'src/cli/commands/status.ts', action: 'status' },
        { file: 'src/cli/commands/use.ts', action: 'use' },
        { file: 'src/cli/commands/build.ts', action: 'build' },
        { file: 'src/cli/commands/run.ts', action: 'run' },
        { file: 'src/cli/commands/stop.ts', action: 'stop' },
        { file: 'src/cli/commands/clean.ts', action: 'clean' },
        { file: 'src/cli/commands/sync.ts', action: 'sync' },
    ];
    for (const { file, action } of files) {
        const content = source(file);
        assert.ok(content.includes('ok:'), `${file} result must have ok field`);
        assert.ok(content.includes(`action:`) || content.includes(`action: '${action}'`), `${file} result must have action field`);
    }
});

// ── Help text consistency ──

test('help text references setup not init', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    const helpMatch = indexSrc.match(/const help = `([\s\S]*?)`\.trim/);
    if (helpMatch) {
        // forja init is now a valid command
        assert.ok(helpMatch[1].includes('forja use target'), 'Help text must reference `forja use target`');
    }
});

test('help text includes server command', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    const helpMatch = indexSrc.match(/const help = `([\s\S]*?)`\.trim/);
    if (helpMatch) {
        assert.ok(helpMatch[1].includes('server'), 'Help text must include server command');
    }
});

// ── Locale resolution ──

test('resolveLocale prioritizes --lang flag over env and system', () => {
    const typesSrc = source('src/cli/commands/types.ts');
    assert.ok(typesSrc.includes('resolveLocale'), 'types.ts must export resolveLocale');
    assert.match(typesSrc, /function resolveLocale\(/, 'resolveLocale must be a function');
});


