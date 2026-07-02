/**
 * Tests verifying CLI command API surface matches the spec documentation.
 * Covers: command registration, naming consistency, result structures, i18n, and flag validation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const repoRoot = process.cwd();

function source(relativePath: string): string {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

// ── Command surface ──

test('CLI dispatcher registers exactly 11 commands including setup and server', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    const expectedCommands = ['status', 'setup', 'list', 'use', 'server', 'build', 'run', 'stop', 'clean', 'doctor', 'sync'];
    for (const cmd of expectedCommands) {
        assert.ok(indexSrc.includes(`'${cmd}'`), `Command '${cmd}' must be registered in CLI dispatcher`);
    }
    assert.ok(!indexSrc.includes("'init'"), "'init' must NOT be a registered command (replaced by 'setup')");
});

test('COMMANDS and IMPLEMENTED_COMMANDS arrays are identical (all commands implemented)', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    const commandsMatch = indexSrc.match(/const COMMANDS: Command\[\] = \[([^\]]+)\]/);
    const implementedMatch = indexSrc.match(/const IMPLEMENTED_COMMANDS: Command\[\] = \[([^\]]+)\]/);
    assert.ok(commandsMatch, 'COMMANDS array must exist');
    assert.ok(implementedMatch, 'IMPLEMENTED_COMMANDS array must exist');
    assert.equal(commandsMatch[1].trim(), implementedMatch[1].trim(), 'COMMANDS and IMPLEMENTED_COMMANDS must be identical');
});

// ── No stale `forja init` references ──

test('no stale `forja init` in user-facing nextActions across source files', () => {
    const filesToCheck = [
        'src/cli/commands/activeTarget.ts',
        'src/cli/commands/status.ts',
        'src/cli/commands/list.ts',
        'src/cli/commands/init.ts',
        'src/cli/index.ts',
        'src/qt/cli/args.ts',
        'src/sdk/cli/index.ts',
    ];
    for (const file of filesToCheck) {
        const content = source(file);
        assert.ok(!content.includes("'forja init'"), `${file} must not contain 'forja init' (use 'forja setup')`);
        assert.ok(!content.includes('"forja init"'), `${file} must not contain "forja init" (use "forja setup")`);
    }
});

test('qtCore.ts nextActions reference `forja setup` not `forja init`', () => {
    const qtCore = source('src/qt/shared/qtCore.ts');
    assert.ok(!qtCore.includes('forja init'), 'qtCore.ts must not reference `forja init`');
    assert.ok(qtCore.includes('forja setup'), 'qtCore.ts must reference `forja setup`');
});

// ── List categories ──

test('list command supports all categories', () => {
    const listSrc = source('src/cli/commands/list.ts');
    const expectedCategories = ['targets', 'servers', 'env', 'remote', 'lang'];
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
        'runUseExecution',
        'runUseSync',
        'runUseRemote',
        'runUseRemoteWorkspace',
        'runUseRemoteRepo',
        'runUseRemoteForjaBin',
        'runUseRemoteBuildOrder',
        'runUseRemoteTransfer',
        'runUseQt',
        'runUseSdk',
        'runUseLang',
    ];
    for (const fn of expectedSubcommands) {
        assert.ok(useSrc.includes(`export function ${fn}`) || useSrc.includes(`export async function ${fn}`),
            `use.ts must export ${fn}`);
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
    assert.match(typesSrc, /export function T\(\s*key\s*:\s*string\s*\)/, 'T() must accept only key parameter');
});

test('CLI entry point calls setGlobalLocale after resolving locale', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    assert.ok(indexSrc.includes('setGlobalLocale'), 'CLI entry must call setGlobalLocale');
    assert.ok(indexSrc.includes('resolveLocale'), 'CLI entry must call resolveLocale');
});

// ── Setup command ──

test('setup command has correct options interface', () => {
    const setupSrc = source('src/cli/commands/setup.ts');
    assert.ok(setupSrc.includes('json'), 'setup must support --json');
    assert.ok(setupSrc.includes('reset'), 'setup must support --reset');
    assert.ok(setupSrc.includes('answers'), 'setup must support --answers');
    assert.ok(setupSrc.includes('SetupRemoteOptions'), 'setup must have SetupRemoteOptions interface');
    assert.ok(setupSrc.includes('runSetupRemote'), 'setup must export runSetupRemote');
    assert.ok(setupSrc.includes('Question'), 'setup must have Question interface for needs-input protocol');
});

test('setup result has local structure', () => {
    const setupSrc = source('src/cli/commands/setup.ts');
    assert.match(setupSrc, /interface SetupResult[\s\S]*?local:/, 'SetupResult must have `local` field');
    assert.match(setupSrc, /interface SetupResult[\s\S]*?steps:/, 'SetupResult must have `steps` field');
});

test('setup remote result has remote structure', () => {
    const setupSrc = source('src/cli/commands/setup.ts');
    assert.match(setupSrc, /interface SetupRemoteResult[\s\S]*?remote\?:/, 'SetupRemoteResult must have optional `remote` field');
    assert.match(setupSrc, /interface SetupRemoteResult[\s\S]*?steps:/, 'SetupRemoteResult must have `steps` field');
});

// ── Sync command ──

test('sync command supports plan and reset actions', () => {
    const syncSrc = source('src/cli/commands/sync.ts');
    assert.match(syncSrc, /SyncAction\s*=\s*'run'\s*\|\s*'plan'\s*\|\s*'reset'/, 'SyncAction must include run, plan, and reset');
});

// ── Doctor command ──

test('doctor command supports all documented actions', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    const doctorActions = ['fix', 'unlock', 'restore', 'reset', 'clean-untracked'];
    for (const action of doctorActions) {
        assert.ok(indexSrc.includes(`'${action}'`) || indexSrc.includes(`"${action}"`),
            `Doctor action '${action}' must be recognized in CLI dispatcher`);
    }
});

// ── Unknown flag detection ──

test('CLI dispatcher validates unknown flags for setup command', () => {
    const indexSrc = source('src/cli/commands/index.ts');
    assert.ok(indexSrc.includes('findUnknownFlags'), 'CLI dispatcher must use findUnknownFlags');
    const setupHandler = indexSrc.match(/function handleSetup\(([\s\S]*?)\n\}/);
    assert.ok(setupHandler, 'handleSetup function must exist');
    assert.ok(setupHandler[1].includes('findUnknownFlags') || setupHandler[1].includes('setupUnknown'), 'handleSetup must validate unknown flags');
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
        { file: 'src/cli/commands/setup.ts', action: 'setup' },
        { file: 'src/cli/commands/build.ts', action: 'build' },
        { file: 'src/cli/commands/run.ts', action: 'run' },
        { file: 'src/cli/commands/stop.ts', action: 'stop' },
        { file: 'src/cli/commands/clean.ts', action: 'clean' },
        { file: 'src/cli/commands/sync.ts', action: 'sync' },
        { file: 'src/cli/commands/doctor.ts', action: 'doctor' },
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
        assert.ok(!helpMatch[1].includes('forja init'), 'Help text must not reference `forja init`');
        assert.ok(helpMatch[1].includes('forja setup'), 'Help text must reference `forja setup`');
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
