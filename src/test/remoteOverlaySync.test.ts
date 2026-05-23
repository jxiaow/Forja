import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildLocalOverlayPlan, executeRemoteOverlaySync } from '../remote/core/overlaySync';

const tmpDirs: string[] = [];

test.after(() => {
    for (const dir of tmpDirs) { fs.rmSync(dir, { recursive: true, force: true }); }
});

function workspaceWithRepo(name: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-remote-overlay-'));
    tmpDirs.push(root);
    fs.mkdirSync(path.join(root, name, '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, name, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, name, 'generated'), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'src/main.cpp'), 'main', 'utf8');
    fs.writeFileSync(path.join(root, name, 'generated/version.h'), 'version', 'utf8');
    return root;
}

function fakeGit(status: string) {
    return {
        async exec() {
            return { exitCode: 0, stdout: status, stderr: '' };
        }
    };
}

test('buildLocalOverlayPlan classifies tracked uploads untracked uploads and tracked deletions', async () => {
    const workspace = workspaceWithRepo('qt-app');
    const result = await buildLocalOverlayPlan({
        workspace,
        ignore: ['ignored'],
        git: fakeGit(' M src/main.cpp\nA  generated/version.h\n D old/removed.cpp\n?? src/new.cpp\n?? ignored/cache.bin\n')
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.repos[0].trackedUploads.map(item => item.path), ['src/main.cpp', 'generated/version.h']);
    assert.deepEqual(result.repos[0].untrackedUploads.map(item => item.path), ['src/new.cpp']);
    assert.deepEqual(result.repos[0].deletedTracked, ['old/removed.cpp']);
    assert.deepEqual(result.repos[0].skipped, ['ignored/cache.bin']);
});

test('buildLocalOverlayPlan rejects unsafe git status paths before remote sync', async () => {
    const workspace = workspaceWithRepo('qt-app');
    const result = await buildLocalOverlayPlan({
        workspace,
        ignore: [],
        git: fakeGit(' M ../escape.cpp\n')
    });

    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0].message, /非法 overlay 路径/);
});

test('executeRemoteOverlaySync captures underlay uploads files deletes tracked paths and writes manifest', async () => {
    const workspace = workspaceWithRepo('qt-app');
    const plan = await buildLocalOverlayPlan({
        workspace,
        ignore: [],
        git: fakeGit(' M src/main.cpp\n?? src/new.cpp\n D old/removed.cpp\n')
    });
    assert.equal(plan.ok, true);

    const commands: string[] = [];
    const uploads: Array<{ localPath: string; remotePath: string }> = [];
    const result = await executeRemoteOverlaySync({
        remotePath: '/remote/ws',
        targetId: 'target-a',
        plan,
        runner: {
            async run(command: string) {
                commands.push(command);
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        },
        uploader: {
            async upload(localPath: string, remotePath: string) {
                uploads.push({ localPath, remotePath });
            }
        }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.repos[0].uploaded, ['src/main.cpp', 'src/new.cpp']);
    assert.deepEqual(result.repos[0].deletedTracked, ['old/removed.cpp']);
    assert.equal(uploads.length, 2);
    assert.ok(uploads.some(item => item.remotePath === '/remote/ws/qt-app/src/main.cpp'));
    assert.ok(uploads.some(item => item.remotePath === '/remote/ws/qt-app/src/new.cpp'));
    const joined = commands.join('\n');
    assert.match(joined, /underlay/);
    assert.match(joined, /overlay\.json/);
    assert.match(joined, /old\/removed\.cpp/);
    assert.match(joined, /rm -f/);
    assert.doesNotMatch(joined, /git clean|reset --hard/);
});

test('executeRemoteOverlaySync fails before manifest update when upload fails', async () => {
    const workspace = workspaceWithRepo('qt-app');
    const plan = await buildLocalOverlayPlan({ workspace, ignore: [], git: fakeGit(' M src/main.cpp\n') });
    const commands: string[] = [];
    const result = await executeRemoteOverlaySync({
        remotePath: '/remote/ws',
        targetId: 'target-a',
        plan,
        runner: {
            async run(command: string) {
                commands.push(command);
                return { exitCode: 0, stdout: '', stderr: '' };
            }
        },
        uploader: {
            async upload() {
                throw new Error('upload failed');
            }
        }
    });

    assert.equal(result.ok, false);
    assert.match(result.diagnostics[0].message, /upload failed/);
    assert.equal(commands.some(command => command.includes('overlay.json') && command.includes('tracked')), false);
});
