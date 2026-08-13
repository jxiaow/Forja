import test, { after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { runBuild } from '../cli/commands/build';
import { runInit } from '../cli/commands/init';
import { runUseTarget } from '../cli/commands/use';
import { buildCommand } from '../cpp/shared/plan';
import {
    createEmptyWorkspaceConfig,
    loadWorkspaceConfig,
    registerWorkroot,
    saveWorkspaceConfig,
    unregisterWorkroot,
    type TargetProfile,
} from '../core/workspaceStore';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-script-workflow-'));
const CONFIG_DIR = path.join(TEST_DIR, 'config');
const OLD_CONFIG = process.env.FORJA_CONFIG_DIR;
fs.mkdirSync(CONFIG_DIR);
process.env.FORJA_CONFIG_DIR = CONFIG_DIR;

after(() => {
    process.env.FORJA_CONFIG_DIR = OLD_CONFIG;
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

function createWorkspace(name: string): string {
    const workspace = path.join(TEST_DIR, name);
    fs.mkdirSync(workspace, { recursive: true });
    return workspace;
}

function saveActiveTarget(workspace: string, target: TargetProfile): void {
    registerWorkroot(workspace);
    const config = createEmptyWorkspaceConfig(workspace);
    config.targets[target.id] = target;
    config.activeTarget = target.id;
    saveWorkspaceConfig(config);
}

function runCli(workspace: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
    const cliPath = path.join(process.cwd(), 'out', 'cli', 'index.js');
    const result = spawnSync(process.execPath, [cliPath, ...args], {
        cwd: workspace,
        encoding: 'utf8',
        env: { ...process.env, FORJA_CONFIG_DIR: CONFIG_DIR },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('build --project preserves the requested script when a saved C++ target exists', async () => {
    const workspace = createWorkspace('explicit-script');
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    fs.writeFileSync(path.join(workspace, 'saved.sh'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(workspace, 'requested.sh'), '#!/bin/sh\n');
    saveActiveTarget(workspace, {
        id: 'cpp-saved-debug-x64',
        name: 'saved',
        kind: 'cpp',
        project: 'CMakeLists.txt',
        mode: 'debug',
        arch: 'x64',
        toolchain: {},
        buildScript: 'saved.sh',
    });

    try {
        const result = await runBuild(workspace, 'default', { plan: true, project: 'requested.sh' });
        const command = result.plan?.commands?.join(' ') || '';
        assert.equal(result.ok, true);
        assert.match(command, /requested\.sh/);
        assert.doesNotMatch(command, /saved\.sh|CMakeLists\.txt/);
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('use target persists buildScript through resolution and save', async () => {
    const workspace = createWorkspace('persist-script');
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    fs.writeFileSync(path.join(workspace, 'build.sh'), '#!/bin/sh\n');

    try {
        const result = await runUseTarget(workspace, {
            project: 'CMakeLists.txt',
            buildScript: 'build.sh',
            mode: 'release',
            arch: 'x64',
            vsInstall: path.join(workspace, 'vs'),
            interactive: false,
            json: true,
        });
        const config = loadWorkspaceConfig(workspace);
        const target = config.activeTarget ? config.targets[config.activeTarget] : undefined;

        assert.equal(result.ok, true);
        assert.equal(target?.buildScript, 'build.sh');
        assert.equal(result.activeTarget?.buildScript, 'build.sh');
        assert.ok(result.changed?.includes('buildScript'));
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('CLI accepts an empty build-script value to clear the active target setting', () => {
    const workspace = createWorkspace('clear-script');
    fs.writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    fs.writeFileSync(path.join(workspace, 'build.sh'), '#!/bin/sh\n');
    saveActiveTarget(workspace, {
        id: 'cpp-clear-debug-x64',
        name: 'clear',
        kind: 'cpp',
        project: 'CMakeLists.txt',
        mode: 'debug',
        arch: 'x64',
        toolchain: {},
        buildScript: 'build.sh',
    });

    try {
        const cli = runCli(workspace, ['use', 'target', '--build-script', '', '--json']);
        const result = JSON.parse(cli.stdout);
        const config = loadWorkspaceConfig(workspace);
        const target = config.activeTarget ? config.targets[config.activeTarget] : undefined;

        assert.equal(cli.status, 0, cli.stderr);
        assert.equal(result.ok, true);
        assert.equal(target?.buildScript, undefined);
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('script-only workspace can be initialized from answers', async () => {
    const workspace = createWorkspace('answers-script-only');
    fs.writeFileSync(path.join(workspace, 'BUILD.BAT'), '@echo off\n');

    try {
        const result = await runInit(workspace, {
            interactive: false,
            json: true,
            answers: {
                project: 'BUILD.BAT',
                mode: 'release',
                arch: 'x64',
                vsInstall: path.join(workspace, 'vs'),
            },
        });

        assert.equal(result.ok, true);
        assert.equal(result.target?.kind, 'cpp');
        assert.equal(result.target?.project, 'BUILD.BAT');
    } finally {
        unregisterWorkroot(workspace);
    }
});

test('script-only workspace reaches the interactive manual path picker', async () => {
    const workspace = createWorkspace('interactive-script-only');
    fs.writeFileSync(path.join(workspace, 'build.sh'), '#!/bin/sh\n');
    const promptModule = require('../cli/commands/prompt');
    const envModule = require('../qt/env/envDetector');
    const originalConfirm = promptModule.confirm;
    const originalPrompt = promptModule.prompt;
    const originalChoose = promptModule.choose;
    const originalChooseRequired = promptModule.chooseRequired;
    const originalDetectEnv = envModule.detectEnv;
    promptModule.confirm = async () => true;
    promptModule.prompt = async () => 'build.sh';
    promptModule.choose = async () => undefined;
    promptModule.chooseRequired = async (_message: string, items: unknown[]) => items[0];
    envModule.detectEnv = async () => ({ qt: undefined, qtCandidates: [], vs: undefined, vsCandidates: [], jom: undefined });

    try {
        const result = await runInit(workspace, { interactive: true, json: false });
        assert.equal(result.ok, true);
        assert.equal(result.target?.project, 'build.sh');
    } finally {
        promptModule.confirm = originalConfirm;
        promptModule.prompt = originalPrompt;
        promptModule.choose = originalChoose;
        promptModule.chooseRequired = originalChooseRequired;
        envModule.detectEnv = originalDetectEnv;
        unregisterWorkroot(workspace);
    }
});

test('CLI accepts long-option text as the build-args value', () => {
    const workspace = createWorkspace('long-build-args');
    fs.writeFileSync(path.join(workspace, 'build.sh'), '#!/bin/sh\n');

    const cli = runCli(workspace, [
        'build', '--plan', '--project', 'build.sh', '--build-args', '--target release', '--json',
    ]);
    const result = JSON.parse(cli.stdout);
    const command = result.plan?.commands?.join(' ') || '';

    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(result.ok, true);
    assert.match(command, /--target release/);
});

test('planner matches script extensions case-insensitively', () => {
    const commands = buildCommand({
        action: 'build',
        workspace: TEST_DIR,
        project: path.join(TEST_DIR, 'BUILD.BAT'),
        mode: 'debug',
        arch: 'x64',
    });

    assert.match(commands[0], /call "BUILD\.BAT"/);
    assert.doesNotMatch(commands[0], /make -C/);
});

test('build-script update rejects Qt targets and unsupported extensions', async () => {
    const qtWorkspace = createWorkspace('reject-qt-script');
    fs.writeFileSync(path.join(qtWorkspace, 'app.pro'), 'TEMPLATE = app\n');
    fs.writeFileSync(path.join(qtWorkspace, 'build.sh'), '#!/bin/sh\n');
    saveActiveTarget(qtWorkspace, {
        id: 'qt-app-debug-x64',
        name: 'app',
        kind: 'qt',
        project: 'app.pro',
        mode: 'debug',
        arch: 'x64',
        toolchain: {},
    });

    const cppWorkspace = createWorkspace('reject-extension');
    fs.writeFileSync(path.join(cppWorkspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    fs.writeFileSync(path.join(cppWorkspace, 'build.txt'), 'not a supported script\n');
    saveActiveTarget(cppWorkspace, {
        id: 'cpp-app-debug-x64',
        name: 'app',
        kind: 'cpp',
        project: 'CMakeLists.txt',
        mode: 'debug',
        arch: 'x64',
        toolchain: {},
    });

    try {
        const qtResult = await runUseTarget(qtWorkspace, { buildScript: 'build.sh' });
        const extensionResult = await runUseTarget(cppWorkspace, { buildScript: 'build.txt' });

        assert.equal(qtResult.ok, false);
        assert.equal(extensionResult.ok, false);
        assert.equal(loadWorkspaceConfig(qtWorkspace).targets['qt-app-debug-x64'].buildScript, undefined);
        assert.equal(loadWorkspaceConfig(cppWorkspace).targets['cpp-app-debug-x64'].buildScript, undefined);
    } finally {
        unregisterWorkroot(qtWorkspace);
        unregisterWorkroot(cppWorkspace);
    }
});
