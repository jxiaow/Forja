import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getProjectGroup, groupProjectCandidates, runInit, type ProjectCandidate } from '../cli/commands/init';

test('getProjectGroup normalizes worktrees and keeps top-level project', () => {
    assert.equal(getProjectGroup('qt_client/qt_linux_pc_client/CMakeLists.txt'), 'qt_client');
    assert.equal(getProjectGroup('qt_client/.worktrees/feature/qt_linux_pc_client/CMakeLists.txt'), 'qt_client');
    assert.equal(getProjectGroup('qt_client/.worktrees/feature/foo/qt_linux_pc_client/CMakeLists.txt'), 'qt_client');
    assert.equal(getProjectGroup('.worktrees/feature/foo/qt_linux_pc_client/CMakeLists.txt'), '其他');
    assert.equal(getProjectGroup('xyframework/media_engine/build/cmake/CMakeLists.txt'), 'xyframework');
    assert.equal(getProjectGroup('xyframework/bifrost/build/windows/bifrost.sln'), 'xyframework');
    assert.equal(getProjectGroup('CMakeLists.txt'), '其他');
});

test('groupProjectCandidates preserves build and worktree candidates', () => {
    const candidates: ProjectCandidate[] = [
        { kind: 'cpp', project: 'qt_client/.worktrees/feature/CMakeLists.txt', label: 'worktree' },
        { kind: 'cpp', project: 'xyframework/media_engine/build/cmake/CMakeLists.txt', label: 'build' },
    ];

    const groups = groupProjectCandidates(candidates);

    assert.deepEqual(groups.map(group => group.name), ['qt_client', 'xyframework']);
    assert.deepEqual(groups[0].candidates.map(candidate => candidate.project), [
        'qt_client/.worktrees/feature/CMakeLists.txt',
    ]);
    assert.deepEqual(groups[1].candidates.map(candidate => candidate.project), [
        'xyframework/media_engine/build/cmake/CMakeLists.txt',
    ]);
});

test('init JSON exposes groups while retaining original project paths', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-grouped-init-'));
    fs.mkdirSync(path.join(workspace, 'xyframework', 'media_engine', 'build', 'cmake'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'qt_client', '.worktrees', 'feature', 'app'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'qt_client', 'build', 'legacy'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'xyframework', 'media_engine', 'build', 'cmake', 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    fs.writeFileSync(path.join(workspace, 'qt_client', '.worktrees', 'feature', 'app', 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.14)\n');
    fs.writeFileSync(path.join(workspace, 'qt_client', '.worktrees', 'feature', 'app', 'app.pro'), 'QT += core\n');
    fs.writeFileSync(path.join(workspace, 'qt_client', 'build', 'legacy', 'legacy.pro'), 'QT += core\n');

    const result = await runInit(workspace, { workroot: workspace, json: true, interactive: false });
    const projectQuestion = result.questions?.find(question => question.id === 'project') as
        | { choices?: string[]; choicesBy?: { questionId: string; values: Record<string, string[]> } }
        | undefined;

    assert.equal(result.ok, false);
    assert.deepEqual(result.questions?.[0]?.id, 'projectGroup');
    assert.equal(projectQuestion?.choices, undefined);
    assert.equal(projectQuestion?.choicesBy?.questionId, 'projectGroup');
    assert.ok(projectQuestion?.choicesBy?.values.xyframework.includes('xyframework/media_engine/build/cmake/CMakeLists.txt'));
    assert.ok(projectQuestion?.choicesBy?.values.qt_client.includes('qt_client/.worktrees/feature/app/CMakeLists.txt'));
    assert.ok(projectQuestion?.choicesBy?.values.qt_client.includes('qt_client/.worktrees/feature/app/app.pro'));
    assert.ok(projectQuestion?.choicesBy?.values.qt_client.includes('qt_client/build/legacy/legacy.pro'));
    assert.equal('projectGroups' in result, false);
    fs.rmSync(workspace, { recursive: true, force: true });
});
