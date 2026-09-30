/**
 * CMake 构建路径深化测试：
 * - plan 层：CMakePresets.json 选择 / 透传 / ${sourceDir} 展开 / 非法 JSON 回退 / 无 preset 旧路径
 * - 配置层：cmakeConfigureArgs 持久化（workspaceStore cppModulePrefs）
 * - CLI 层：use target cmake-args --add/--rm、build --plan 追加参数与 warning 诊断
 */
import test, { after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { buildCommand, buildCommandDetailed } from '../cpp/shared/plan';
import { runBuild } from '../cli/commands/build';
import { runCMakeArgs } from '../cli/commands/use';
import {
    createEmptyWorkspaceConfig,
    loadWorkspaceConfig,
    registerWorkroot,
    saveWorkspaceConfig,
    unregisterWorkroot,
    workspaceConfigPath,
    type TargetProfile,
} from '../core/workspaceStore';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-cmake-presets-'));
const CONFIG_DIR = path.join(TEST_DIR, 'config');
const OLD_CONFIG = process.env.FORJA_CONFIG_DIR;
fs.mkdirSync(CONFIG_DIR);
process.env.FORJA_CONFIG_DIR = CONFIG_DIR;

after(() => {
    process.env.FORJA_CONFIG_DIR = OLD_CONFIG;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

let dirCounter = 0;
function createCMakeProject(presetContent?: string): string {
    const dir = path.join(TEST_DIR, `proj-${++dirCounter}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    if (presetContent !== undefined) {
        fs.writeFileSync(path.join(dir, 'CMakePresets.json'), presetContent);
    }
    return dir;
}

function planOptions(project: string, mode: 'debug' | 'release', extra: Record<string, unknown> = {}) {
    return {
        action: 'build' as const,
        workspace: path.dirname(project),
        project,
        mode,
        arch: 'x64' as const,
        ...extra,
    };
}

function cmakeLists(dir: string): string {
    return path.join(dir, 'CMakeLists.txt');
}

// ── 1. preset 命中 ──

test('preset hit: release mode selects the matching configure preset via --preset', () => {
    const dir = createCMakeProject(JSON.stringify({
        version: 3,
        configurePresets: [
            { name: 'debug-local', binaryDir: './build-debug' },
            { name: 'release-win', binaryDir: './build-release' },
        ],
    }));
    const { commands, warnings } = buildCommandDetailed(planOptions(cmakeLists(dir), 'release'));

    assert.deepEqual(warnings, []);
    assert.equal(commands[0], `cmake --preset "release-win" -S "${dir}" -B "${path.join(dir, 'build-release')}"`);
    assert.ok(commands[1].startsWith(`cmake --build "${path.join(dir, 'build-release')}"`));
});

// ── 2. generator/toolchain/cacheVariables 透传（由 --preset 承载，不重复编码） ──

test('preset with generator/toolchainFile/cacheVariables is delegated to cmake --preset', () => {
    const dir = createCMakeProject(JSON.stringify({
        version: 3,
        configurePresets: [{
            name: 'ReleaseWithChecks',
            generator: 'Ninja Multi-Config',
            toolchainFile: '${sourceDir}/toolchain-arm.cmake',
            environment: { CFLAGS: '-O2' },
            cacheVariables: { BUILD_TESTS: true, CMAKE_BUILD_TYPE: 'Release' },
        }],
    }));
    const { commands, warnings } = buildCommandDetailed(planOptions(cmakeLists(dir), 'release'));

    assert.deepEqual(warnings, []);
    // 不重复编码 -G / -D 参数：cmake 从 preset 文件读取
    assert.doesNotMatch(commands[0], /-G |-DBUILD_TESTS|-DCMAKE_BUILD_TYPE/);
    assert.match(commands[0], /--preset "ReleaseWithChecks"/);
    // binaryDir 缺省 → ./build（相对 sourceDir）
    assert.ok(commands[0].includes(`-B "${path.join(dir, 'build')}"`));
});

// ── 3. ${sourceDir} 占位符展开 ──

test('preset binaryDir expands ${sourceDir} placeholder to absolute project dir', () => {
    const dir = createCMakeProject(JSON.stringify({
        version: 3,
        configurePresets: [{ name: 'debug-run', binaryDir: '${sourceDir}/out/build/dbg' }],
    }));
    const { commands, warnings } = buildCommandDetailed(planOptions(cmakeLists(dir), 'debug'));

    assert.deepEqual(warnings, []);
    const expected = path.join(dir, 'out', 'build', 'dbg');
    assert.ok(commands[0].includes(`-B "${expected}"`), commands[0]);
    assert.ok(commands[1].startsWith(`cmake --build "${expected}"`), commands[1]);
});

test('preset file one level above the project is discovered', () => {
    const outer = createCMakeProject();
    const inner = path.join(outer, 'src');
    fs.mkdirSync(inner);
    fs.writeFileSync(path.join(inner, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    fs.writeFileSync(path.join(outer, 'CMakePresets.json'), JSON.stringify({
        version: 3,
        configurePresets: [{ name: 'release-ci', binaryDir: '${sourceDir}/out' }],
    }));
    const { commands, warnings } = buildCommandDetailed(planOptions(cmakeLists(inner), 'release'));

    assert.deepEqual(warnings, []);
    assert.match(commands[0], /--preset "release-ci"/);
    assert.ok(commands[0].includes(`-S "${inner}"`));
});

// ── 4. 非法 JSON / 无匹配 preset → 回退 + warning ──

test('invalid JSON preset falls back to -DCMAKE_BUILD_TYPE with warning', () => {
    const dir = createCMakeProject('{ "configurePresets": [oops');
    const { commands, warnings } = buildCommandDetailed(planOptions(cmakeLists(dir), 'release'));

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, 'cpp.cmakePresetInvalidJson');
    assert.equal(commands.some(c => c.includes('-DCMAKE_BUILD_TYPE=Release')), true);
    assert.doesNotMatch(commands.join(' '), /--preset/);
});

test('no matching preset falls back with warning', () => {
    const dir = createCMakeProject(JSON.stringify({
        version: 3,
        configurePresets: [{ name: 'only-debug', binaryDir: './build' }],
    }));
    const { commands, warnings } = buildCommandDetailed(planOptions(cmakeLists(dir), 'release'));

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, 'cpp.cmakePresetNoMatch');
    assert.deepEqual(warnings[0].params, ['release']);
    assert.equal(commands.some(c => c.includes('-DCMAKE_BUILD_TYPE=Release')), true);
});

// ── 5. 无 preset 文件 → 完全旧路径，无 warning ──

test('no preset file keeps the legacy configure command unchanged', () => {
    const dir = createCMakeProject();
    const project = cmakeLists(dir);
    const { commands, warnings } = buildCommandDetailed(planOptions(project, 'debug'));
    const legacy = buildCommand(planOptions(project, 'debug'));

    assert.deepEqual(warnings, []);
    assert.deepEqual(commands, legacy);
    assert.equal(commands[0], `cmake -B "${path.join(dir, 'build')}" -S "${dir}" -DCMAKE_BUILD_TYPE=Debug`);
});

// ── clean / rebuild 使用 preset binaryDir ──

test('clean action targets the preset-resolved binary dir', () => {
    const dir = createCMakeProject(JSON.stringify({
        version: 3,
        configurePresets: [{ name: 'dev-debug', binaryDir: './build-dev' }],
    }));
    const { commands } = buildCommandDetailed({ ...planOptions(cmakeLists(dir), 'debug'), action: 'clean' });
    assert.equal(commands[0], `cmake --build "${path.join(dir, 'build-dev')}" --target clean`);

    const noPreset = buildCommandDetailed({ ...planOptions(cmakeLists(dir), 'release'), action: 'clean' });
    assert.equal(noPreset.commands[0], `cmake --build "${path.join(dir, 'build')}" --target clean`);
    assert.equal(noPreset.warnings.length, 1);
});

test('rebuild adds --clean-first and preset configure stays first command', () => {
    const dir = createCMakeProject(JSON.stringify({
        version: 3,
        configurePresets: [{ name: 'debug-ci', binaryDir: './build-d' }],
    }));
    const { commands } = buildCommandDetailed({ ...planOptions(cmakeLists(dir), 'debug'), action: 'rebuild' });
    assert.match(commands[0], /--preset "debug-ci"/);
    assert.match(commands[1], /--clean-first --parallel/);
});

// ── cmakeConfigureArgs 追加 ──

test('cmakeConfigureArgs append to legacy and preset configure commands', () => {
    const dirLegacy = createCMakeProject();
    const legacy = buildCommandDetailed(planOptions(cmakeLists(dirLegacy), 'debug', {
        cmakeConfigureArgs: ['-DUSE_CCACHE=ON', '-DBUILD_TESTS=OFF'],
    }));
    assert.match(legacy.commands[0], /-DCMAKE_BUILD_TYPE=Debug -DUSE_CCACHE=ON -DBUILD_TESTS=OFF$/);

    const dirPreset = createCMakeProject(JSON.stringify({
        version: 3,
        configurePresets: [{ name: 'release-p', binaryDir: './build-r' }],
    }));
    const preset = buildCommandDetailed(planOptions(cmakeLists(dirPreset), 'release', {
        cmakeConfigureArgs: ['-DGIT_SUBMODULE=ON'],
    }));
    assert.match(preset.commands[0], /--preset "release-p" .* -DGIT_SUBMODULE=ON$/);
});

// ── 配置持久化（workspaceStore cppModulePrefs） ──

function saveActiveTarget(workspace: string, target: TargetProfile): void {
    registerWorkroot(workspace);
    const config = createEmptyWorkspaceConfig(workspace);
    config.targets[target.id] = target;
    config.activeTarget = target.id;
    saveWorkspaceConfig(config);
}

test('cmakeConfigureArgs round-trips through workspaceStore and is sanitized', () => {
    const workspace = createCMakeProject();
    registerWorkroot(workspace);
    const config = createEmptyWorkspaceConfig(workspace);
    config.cppModulePrefs.cmakeConfigureArgs = ['-DA=1', '', 42 as unknown as string, '-DB=2'];
    saveWorkspaceConfig(config);

    const loaded = loadWorkspaceConfig(workspace);
    assert.deepEqual(loaded.cppModulePrefs.cmakeConfigureArgs, ['-DA=1', '-DB=2']);

    // 旧文件（无该字段）→ 默认空数组
    const legacyWs = createCMakeProject();
    registerWorkroot(legacyWs);
    saveWorkspaceConfig(createEmptyWorkspaceConfig(legacyWs));
    const rawPath = workspaceConfigPath(legacyWs);
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    delete raw.cppModulePrefs.cmakeConfigureArgs;
    fs.writeFileSync(rawPath, JSON.stringify(raw));
    assert.deepEqual(loadWorkspaceConfig(legacyWs).cppModulePrefs.cmakeConfigureArgs, []);
    unregisterWorkroot(legacyWs);
    unregisterWorkroot(workspace);
});

// ── CLI flag：use target cmake-args ──

test('use target cmake-args --add/--rm persists cpp.cmakeConfigureArgs', () => {
    const workspace = createCMakeProject();
    saveActiveTarget(workspace, {
        id: 'cpp-app-debug-x64',
        name: 'app',
        kind: 'cpp',
        project: 'CMakeLists.txt',
        mode: 'debug',
        arch: 'x64',
        toolchain: {},
    });

    try {
        const add = runCMakeArgs(workspace, ['-DFOO=1', '-DBAR=2'], true, false);
        assert.equal(add.ok, true);
        assert.ok(add.changed?.includes('cpp.cmakeConfigureArgs'));
        assert.deepEqual(loadWorkspaceConfig(workspace).cppModulePrefs.cmakeConfigureArgs, ['-DFOO=1', '-DBAR=2']);

        // 去重
        const addDup = runCMakeArgs(workspace, ['-DFOO=1'], true, false);
        assert.equal(addDup.ok, true);
        assert.deepEqual(loadWorkspaceConfig(workspace).cppModulePrefs.cmakeConfigureArgs, ['-DFOO=1', '-DBAR=2']);

        const rm = runCMakeArgs(workspace, ['-DBAR=2'], false, true);
        assert.equal(rm.ok, true);
        assert.deepEqual(loadWorkspaceConfig(workspace).cppModulePrefs.cmakeConfigureArgs, ['-DFOO=1']);

        const conflict = runCMakeArgs(workspace, ['-DX'], true, true);
        assert.equal(conflict.ok, false);
        const missing = runCMakeArgs(workspace, [], true, false);
        assert.equal(missing.ok, false);
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('CLI subprocess: use target cmake-args --add then build --plan includes args', () => {
    const workspace = createCMakeProject();
    saveActiveTarget(workspace, {
        id: 'cpp-app-debug-x64',
        name: 'app',
        kind: 'cpp',
        project: 'CMakeLists.txt',
        mode: 'debug',
        arch: 'x64',
        toolchain: {},
    });
    const cliPath = path.join(process.cwd(), 'out', 'cli', 'index.js');

    function runCli(args: string[]) {
        const r = spawnSync(process.execPath, [cliPath, ...args], {
            cwd: workspace,
            encoding: 'utf8',
            env: { ...process.env, FORJA_CONFIG_DIR: CONFIG_DIR, FORJA_LANG: 'en' },
        });
        return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    }

    try {
        const cli = runCli(['use', 'target', 'cmake-args', '--add', '-DFOO=1', '--json']);
        assert.equal(cli.status, 0, cli.stderr);
        const useJson = JSON.parse(cli.stdout) as Record<string, unknown>;
        assert.equal(useJson.ok, true);

        const build = runCli(['build', '--plan', '--json']);
        assert.equal(build.status, 0, build.stderr);
        const buildJson = JSON.parse(build.stdout) as {
            ok: boolean;
            plan?: { commands?: string[] };
        };
        assert.equal(buildJson.ok, true);
        const configure = buildJson.plan?.commands?.find(c => c.startsWith('cmake -B')) || '';
        assert.match(configure, /-DCMAKE_BUILD_TYPE=Debug -DFOO=1$/);
    } finally {
        unregisterWorkroot(workspace);
    }
});

// ── build --plan 输出 preset warning（新增诊断，不改旧字段） ──

test('build plan surfaces localized preset fallback warning as diagnostic', async () => {
    const workspace = createCMakeProject('{ invalid json');
    saveActiveTarget(workspace, {
        id: 'cpp-app-release-x64',
        name: 'app',
        kind: 'cpp',
        project: 'CMakeLists.txt',
        mode: 'release',
        arch: 'x64',
        toolchain: {},
    });

    try {
        const result = await runBuild(workspace, 'default', { plan: true });
        assert.equal(result.ok, true);
        const warning = (result.diagnostics ?? []).find(d => d.level === 'warning');
        assert.ok(warning, '非法 preset JSON 时 plan 输出应包含 warning 诊断');
        assert.match(warning.message, /CMakePresets\.json/);
        assert.match((result.plan?.commands ?? []).join(' '), /-DCMAKE_BUILD_TYPE=Release/);
    } finally {
        unregisterWorkroot(workspace);
    }
});
