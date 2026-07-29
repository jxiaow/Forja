/**
 * Unit tests for init.ts and candidates.ts core logic.
 * Tests detectToolchain, auto-select, path normalization, and CMake support.
 */
import test, { after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-init-test-'));
const OLD_CONFIG = process.env.FORJA_CONFIG_DIR;
const CONFIG_DIR = path.join(TEST_DIR, 'config');
fs.mkdirSync(CONFIG_DIR);
process.env.FORJA_CONFIG_DIR = CONFIG_DIR;

const cleanup = () => {
    process.env.FORJA_CONFIG_DIR = OLD_CONFIG;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
};

after(cleanup);

// ── candidates.ts: aggregateCandidates ──

test('aggregateCandidates: empty workspace returns no candidates', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'empty-ws');
    fs.mkdirSync(workspace, { recursive: true });
    const result = aggregateCandidates(workspace, null, []);
    assert.equal(result.length, 0);
});

test('aggregateCandidates: detects .pro files as qt candidates', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'qt-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'myapp.pro'), 'QT += core\n');
    const result = aggregateCandidates(workspace, null, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'qt');
    assert.equal(result[0].label, 'myapp');
});

test('aggregateCandidates: detects Makefile as cpp candidate on POSIX', () => {
    if (os.platform() === 'win32') { return; }
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'cpp-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'Makefile'), 'all:\n');
    const result = aggregateCandidates(workspace, null, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'cpp');
});

test('aggregateCandidates: detects CMakeLists.txt as cpp candidate', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'cmake-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    const result = aggregateCandidates(workspace, null, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, 'cpp');
    assert.equal(result[0].label, 'cmake-ws');
});

test('aggregateCandidates: marks current and configured flags', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'flags-ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'QT += core\n');
    const activeProfile = {
        id: 'qt-app-debug-x64',
        name: 'app debug x64',
        kind: 'qt',
        project: 'app.pro',
        mode: 'release',
        arch: 'x64',
        toolchain: {},
    };
    const savedTargets = [activeProfile];
    const result = aggregateCandidates(workspace, activeProfile, savedTargets);
    assert.equal(result.length, 1);
    assert.equal(result[0].current, true);
    assert.equal(result[0].configured, true);
});

test('aggregateCandidates: includes build and deep worktree Qt projects', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'included-qt-dirs');
    const buildDir = path.join(workspace, 'product', 'build', 'legacy');
    const worktreeDir = path.join(workspace, 'product', '.worktrees', 'branch', 'a', 'b', 'c', 'd');
    fs.mkdirSync(buildDir, { recursive: true });
    fs.mkdirSync(worktreeDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'build.pro'), 'QT += core\n');
    fs.writeFileSync(path.join(worktreeDir, 'deep.pro'), 'QT += core\n');

    const projects = aggregateCandidates(workspace, null, []).map((candidate: { project: string }) => candidate.project);

    assert.ok(projects.includes('product/build/legacy/build.pro'));
    assert.ok(projects.includes('product/.worktrees/branch/a/b/c/d/deep.pro'));
});

test('aggregateCandidates: keeps generated and metadata directories excluded', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'excluded-qt-dirs');
    for (const directory of ['node_modules/dependency', '.git/nested', '.forja/cache', 'out/generated']) {
        const targetDir = path.join(workspace, directory);
        fs.mkdirSync(targetDir, { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'ignored.pro'), 'QT += core\n');
    }

    const qtProjects = aggregateCandidates(workspace, null, [])
        .filter((candidate: { kind: string }) => candidate.kind === 'qt');

    assert.deepEqual(qtProjects, []);
});

test('aggregateCandidates: includes CMake projects under build/output', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'build-output-cpp');
    const projectDir = path.join(workspace, 'sdk', 'build', 'output', 'cmake');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');

    const projects = aggregateCandidates(workspace, null, []).map((candidate: { project: string }) => candidate.project);

    assert.ok(projects.includes('sdk/build/output/cmake/CMakeLists.txt'));
});

test('init answers require explicit mode and Windows arch before saving', async () => {
    const { runInit } = require('../cli/commands/init');
    const { isWorkrootRegistered, unregisterWorkroot } = require('../core/workspaceStore');
    const workspace = path.join(TEST_DIR, 'partial-init-answers');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');

    try {
        const result = await runInit(workspace, {
            interactive: false,
            json: true,
            answers: { project: 'CMakeLists.txt' },
        });
        const questionIds = (result.questions || []).map((question: { id: string }) => question.id);

        assert.equal(result.ok, false);
        assert.ok(questionIds.includes('mode'));
        if (process.platform === 'win32') {
            assert.ok(questionIds.includes('arch'));
        } else {
            assert.equal(questionIds.includes('arch'), false);
        }
        assert.equal(isWorkrootRegistered(workspace), false);
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('init --json returns toolchain questions together with initial selection questions', async () => {
    const { runInit } = require('../cli/commands/init');
    const envDetector = require('../qt/env/envDetector');
    const { isWorkrootRegistered, unregisterWorkroot } = require('../core/workspaceStore');
    const workspace = path.join(TEST_DIR, 'initial-toolchain-questions');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'TEMPLATE = app\nTARGET = app\nQT += core\n');

    const originalDetectEnv = envDetector.detectEnv;
    envDetector.detectEnv = async () => ({
        qt: { version: '6.8.0', compiler: 'msvc', path: 'C:\\Qt\\6.8.0\\msvc2022' },
        qtCandidates: [
            { version: '6.8.0', compiler: 'msvc', path: 'C:\\Qt\\6.8.0\\msvc2022' },
            { version: '5.15.13', compiler: 'msvc', path: 'C:\\Qt\\5.15.13\\msvc2019' },
        ],
        vs: { version: '2022', edition: 'Community', installPath: 'C:\\VS2022', devShellPath: '' },
        vsCandidates: [
            { version: '2022', edition: 'Community', installPath: 'C:\\VS2022', devShellPath: '' },
            { version: '2019', edition: 'Community', installPath: 'C:\\VS2019', devShellPath: '' },
        ],
        jom: 'C:\\Qt\\Tools\\jom.exe',
    });

    try {
        const result = await runInit(workspace, { workroot: workspace, interactive: false, json: true });
        const questionIds = (result.questions || []).map((question: { id: string }) => question.id);

        assert.equal(result.ok, false);
        assert.ok(questionIds.includes('projectGroup'));
        assert.ok(questionIds.includes('project'));
        assert.ok(questionIds.includes('mode'));
        assert.ok(questionIds.includes('qtPath'));
        assert.ok(questionIds.includes('vsInstall'));
        assert.equal(isWorkrootRegistered(workspace), false);
    } finally {
        envDetector.detectEnv = originalDetectEnv;
        unregisterWorkroot(workspace);
    }
});

test('init --json asks for workroot before project questions', async () => {
    const { runInit } = require('../cli/commands/init');
    const { isWorkrootRegistered, unregisterWorkroot } = require('../core/workspaceStore');
    const workspace = path.join(TEST_DIR, 'workroot-question');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'TEMPLATE = app\nTARGET = app\n');

    try {
        const result = await runInit(workspace, { interactive: false, json: true });
        assert.equal(result.ok, false);
        assert.deepEqual(result.questions, [{
            id: 'workroot',
            label: 'Work root',
            default: workspace,
        }]);
        const configuredRoot = await runInit(workspace, {
            workroot: workspace,
            interactive: false,
            json: true,
        });
        assert.ok((configuredRoot.questions || []).some((question: { id: string }) => question.id === 'projectGroup'));
        assert.equal(isWorkrootRegistered(workspace), false);
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('init --json asks for Qt and VS when multiple environments are detected', async () => {
    const { runInit } = require('../cli/commands/init');
    const envDetector = require('../qt/env/envDetector');
    const { isWorkrootRegistered, unregisterWorkroot } = require('../core/workspaceStore');
    const workspace = path.join(TEST_DIR, 'multiple-toolchains-init');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'TEMPLATE = app\nTARGET = app\n');

    const originalDetectEnv = envDetector.detectEnv;
    envDetector.detectEnv = async () => ({
        qt: { version: '6.8.0', compiler: 'msvc', path: 'C:\\Qt\\6.8.0\\msvc2022' },
        qtCandidates: [
            { version: '6.8.0', compiler: 'msvc', path: 'C:\\Qt\\6.8.0\\msvc2022' },
            { version: '5.15.13', compiler: 'msvc', path: 'C:\\Qt\\5.15.13\\msvc2019' },
        ],
        vs: { version: '2022', edition: 'Community', installPath: 'C:\\VS2022', devShellPath: '' },
        vsCandidates: [
            { version: '2022', edition: 'Community', installPath: 'C:\\VS2022', devShellPath: '' },
            { version: '2019', edition: 'Community', installPath: 'C:\\VS2019', devShellPath: '' },
        ],
        jom: 'C:\\Qt\\Tools\\jom.exe',
    });

    try {
        const result = await runInit(workspace, {
            interactive: false,
            json: true,
            answers: { project: 'app.pro', mode: 'release', arch: 'x64' },
        });
        const questions = result.questions || [];
        const questionById = (id: string) => questions.find((question: { id: string }) => question.id === id);

        assert.equal(result.ok, false);
        assert.deepEqual(questionById('qtPath')?.choices, [
            'C:\\Qt\\6.8.0\\msvc2022',
            'C:\\Qt\\5.15.13\\msvc2019',
        ]);
        assert.deepEqual(questionById('vsInstall')?.choices, ['C:\\VS2022', 'C:\\VS2019']);
        assert.equal(isWorkrootRegistered(workspace), false);
    } finally {
        envDetector.detectEnv = originalDetectEnv;
        unregisterWorkroot(workspace);
    }
});

test('use target with a new project requires explicit mode and Windows arch', async () => {
    const { runUseTarget } = require('../cli/commands/use');
    const {
        createEmptyWorkspaceConfig,
        loadWorkspaceConfig,
        registerWorkroot,
        saveWorkspaceConfig,
        unregisterWorkroot,
    } = require('../core/workspaceStore');
    const workspace = path.join(TEST_DIR, 'partial-use-target');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    registerWorkroot(workspace);
    saveWorkspaceConfig(createEmptyWorkspaceConfig(workspace));

    try {
        const result = await runUseTarget(workspace, {
            project: 'CMakeLists.txt',
            interactive: false,
            json: true,
        });
        const questionIds = (result.questions || []).map((question: { id: string }) => question.id);

        assert.equal(result.ok, false);
        assert.equal(result.status, 'needs-input');
        assert.match(result.nextAction || '', /--answers <answers\.json>/);
        assert.ok(questionIds.includes('mode'));
        if (process.platform === 'win32') {
            assert.ok(questionIds.includes('arch'));
        } else {
            assert.equal(questionIds.includes('arch'), false);
        }
        assert.deepEqual(loadWorkspaceConfig(workspace).targets, {});
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('C++ scanner excludes generated directories case-insensitively', () => {
    const { aggregateCandidates } = require('../cli/commands/candidates');
    const workspace = path.join(TEST_DIR, 'case-insensitive-cpp-excludes');
    for (const directory of ['Debug', 'Release', 'Out']) {
        const projectDir = path.join(workspace, directory);
        fs.mkdirSync(projectDir, { recursive: true });
        fs.writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    }

    const cppProjects = aggregateCandidates(workspace, null, [])
        .filter((candidate: { kind: string }) => candidate.kind === 'cpp');

    assert.deepEqual(cppProjects, []);
});

test('use target needs-input quotes project paths containing spaces', async () => {
    const { runUseTarget } = require('../cli/commands/use');
    const {
        createEmptyWorkspaceConfig,
        registerWorkroot,
        saveWorkspaceConfig,
        unregisterWorkroot,
    } = require('../core/workspaceStore');
    const workspace = path.join(TEST_DIR, 'space-in-project-path');
    const projectDir = path.join(workspace, 'My Projects');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    registerWorkroot(workspace);
    saveWorkspaceConfig(createEmptyWorkspaceConfig(workspace));

    try {
        const result = await runUseTarget(workspace, {
            project: 'My Projects/CMakeLists.txt',
            interactive: false,
            json: true,
        });
        assert.match(result.nextAction || '', /--project "My Projects\/CMakeLists\.txt"/);
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('switching to a new target does not inherit the active target build settings', async () => {
    const { runUseTarget } = require('../cli/commands/use');
    const {
        createEmptyWorkspaceConfig,
        loadWorkspaceConfig,
        registerWorkroot,
        saveWorkspaceConfig,
        unregisterWorkroot,
    } = require('../core/workspaceStore');
    const workspace = path.join(TEST_DIR, 'new-target-does-not-inherit');
    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(path.join(workspace, 'current'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'current', 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n', { flag: 'w' });
    fs.mkdirSync(path.join(workspace, 'next'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'next', 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    registerWorkroot(workspace);
    const config = createEmptyWorkspaceConfig(workspace);
    config.targets['cpp-current-release-x86'] = {
        id: 'cpp-current-release-x86', name: 'current release x86', kind: 'cpp',
        project: 'current/CMakeLists.txt', mode: 'release', arch: 'x86',
        toolchain: { vsInstall: 'C:/VS/current' },
    };
    config.activeTarget = 'cpp-current-release-x86';
    saveWorkspaceConfig(config);

    try {
        const result = await runUseTarget(workspace, {
            project: 'next/CMakeLists.txt', interactive: false, json: true,
        });

        assert.equal(result.ok, false);
        assert.equal(result.status, 'needs-input');
        assert.ok((result.questions || []).some((question: { id: string }) => question.id === 'mode'));
        assert.match(result.nextAction || '', /--project next\/CMakeLists\.txt/);
        assert.deepEqual(loadWorkspaceConfig(workspace).targets, config.targets);
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('switching to a saved target by project path reuses its saved configuration', async () => {
    const { runUseTarget } = require('../cli/commands/use');
    const {
        createEmptyWorkspaceConfig,
        loadWorkspaceConfig,
        registerWorkroot,
        saveWorkspaceConfig,
        unregisterWorkroot,
    } = require('../core/workspaceStore');
    const workspace = path.join(TEST_DIR, 'saved-target-project-path');
    fs.mkdirSync(path.join(workspace, 'current'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'saved'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'current', 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    fs.writeFileSync(path.join(workspace, 'saved', 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    registerWorkroot(workspace);
    const config = createEmptyWorkspaceConfig(workspace);
    config.targets['cpp-current-release-x86'] = {
        id: 'cpp-current-release-x86', name: 'current release x86', kind: 'cpp',
        project: 'current/CMakeLists.txt', mode: 'release', arch: 'x86',
        toolchain: { vsInstall: 'C:/VS/current' },
    };
    config.targets['cpp-saved-release-x86'] = {
        id: 'cpp-saved-release-x86', name: 'saved release x86', kind: 'cpp',
        project: 'saved/CMakeLists.txt', mode: 'release', arch: 'x86',
        toolchain: { vsInstall: 'C:/VS/saved' },
    };
    config.activeTarget = 'cpp-current-release-x86';
    saveWorkspaceConfig(config);

    try {
        const result = await runUseTarget(workspace, {
            project: path.join('saved', 'CMakeLists.txt'), interactive: false, json: true,
        });

        assert.equal(result.ok, true);
        assert.deepEqual(result.changed, ['activeTarget']);
        assert.equal(loadWorkspaceConfig(workspace).activeTarget, 'cpp-saved-release-x86');
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('switching projects saves the explicitly supplied Qt path', async () => {
    const { runUseTarget } = require('../cli/commands/use');
    const {
        createEmptyWorkspaceConfig,
        loadWorkspaceConfig,
        registerWorkroot,
        saveWorkspaceConfig,
        unregisterWorkroot,
    } = require('../core/workspaceStore');
    const workspace = path.join(TEST_DIR, 'switch-target-saves-qt');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'TEMPLATE = app\nTARGET = app\n');
    registerWorkroot(workspace);
    saveWorkspaceConfig(createEmptyWorkspaceConfig(workspace));

    try {
        const result = await runUseTarget(workspace, {
            project: 'app.pro', mode: 'release', arch: 'x64',
            qtPath: 'C:/Qt/5.15.13/msvc2019', vsInstall: 'C:/VS/2019',
            interactive: false, json: true,
        });

        assert.equal(result.ok, true);
        const activeTarget = loadWorkspaceConfig(workspace).targets[
            loadWorkspaceConfig(workspace).activeTarget!
        ];
        assert.equal(activeTarget.toolchain.qtPath, 'C:/Qt/5.15.13/msvc2019');
        assert.equal(activeTarget.toolchain.vsInstall, 'C:/VS/2019');
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('init for a selected C++ project does not request a Qt path', async () => {
    const { runInit } = require('../cli/commands/init');
    const envDetector = require('../qt/env/envDetector');
    const { unregisterWorkroot } = require('../core/workspaceStore');
    const workspace = path.join(TEST_DIR, 'cpp-init-no-qt-question');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'TEMPLATE = app\nTARGET = app\n');
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    const originalDetectEnv = envDetector.detectEnv;
    envDetector.detectEnv = async () => ({
        qt: undefined,
        qtCandidates: [
            { version: '6.8.0', compiler: 'msvc', path: 'C:/Qt/6.8.0/msvc2022' },
            { version: '5.15.13', compiler: 'msvc', path: 'C:/Qt/5.15.13/msvc2019' },
        ],
        vs: undefined,
        vsCandidates: [
            { version: '2022', edition: 'Community', installPath: 'C:/VS/2022', devShellPath: '' },
            { version: '2019', edition: 'Community', installPath: 'C:/VS/2019', devShellPath: '' },
        ],
        jom: undefined,
    });

    try {
        const result = await runInit(workspace, {
            workroot: workspace, interactive: false, json: true,
            answers: { projectGroup: 'cpp-init-no-qt-question', project: 'CMakeLists.txt', mode: 'release', arch: 'x64' },
        });
        const questionIds = (result.questions || []).map((question: { id: string }) => question.id);

        assert.equal(result.ok, false);
        assert.equal(questionIds.includes('qtPath'), false);
        assert.equal(questionIds.includes('vsInstall'), true);
    } finally {
        envDetector.detectEnv = originalDetectEnv;
        unregisterWorkroot(workspace);
    }
});

test('initial init marks Qt path as inapplicable for C++ projects', async () => {
    const { runInit } = require('../cli/commands/init');
    const envDetector = require('../qt/env/envDetector');
    const { unregisterWorkroot } = require('../core/workspaceStore');
    const workspace = path.join(TEST_DIR, 'initial-cpp-qt-inapplicable');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'app.pro'), 'TEMPLATE = app\nTARGET = app\n');
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    const originalDetectEnv = envDetector.detectEnv;
    envDetector.detectEnv = async () => ({
        qt: undefined,
        qtCandidates: [
            { version: '6.8.0', compiler: 'msvc', path: 'C:/Qt/6.8.0/msvc2022' },
            { version: '5.15.13', compiler: 'msvc', path: 'C:/Qt/5.15.13/msvc2019' },
        ],
        vs: undefined, vsCandidates: [], jom: undefined,
    });

    try {
        const result = await runInit(workspace, { workroot: workspace, interactive: false, json: true });
        const qtQuestion = result.questions?.find((question: { id: string }) => question.id === 'qtPath');

        assert.deepEqual(qtQuestion?.choicesBy?.values['CMakeLists.txt'], []);
        assert.deepEqual(qtQuestion?.choicesBy?.values['app.pro'], [
            'C:/Qt/6.8.0/msvc2022', 'C:/Qt/5.15.13/msvc2019',
        ]);
    } finally {
        envDetector.detectEnv = originalDetectEnv;
        unregisterWorkroot(workspace);
    }
});
