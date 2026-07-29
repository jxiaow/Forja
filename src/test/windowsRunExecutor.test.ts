import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createPlatformRunExecutor } from '../qt/platform/runExecutor';
import {
    cleanStaleDesktopRunFiles,
    parseDesktopRunStatus,
    shouldUseWindowsDesktopRun
} from '../qt/platform/win/runExecutor';

test('Windows desktop runner is selected only for Windows Terminal outside VSCode', () => {
    assert.equal(shouldUseWindowsDesktopRun({ WT_SESSION: 'session-id' }), true);
    assert.equal(shouldUseWindowsDesktopRun({ WT_PROFILE_ID: 'profile-id' }), true);
    assert.equal(shouldUseWindowsDesktopRun({ WT_SESSION: 'session-id', TERM_PROGRAM: 'vscode' }), false);
    assert.equal(shouldUseWindowsDesktopRun({}), false);
    assert.equal(shouldUseWindowsDesktopRun({}, ['pwsh.exe', 'WindowsTerminal.exe', 'explorer.exe']), true);
    assert.equal(shouldUseWindowsDesktopRun({}, ['pwsh.exe', 'Code.exe', 'WindowsTerminal.exe']), false);
    assert.equal(shouldUseWindowsDesktopRun({}, ['pwsh.exe', 'Code - Insiders.exe', 'WindowsTerminal.exe']), false);

    assert.equal(createPlatformRunExecutor({ WT_SESSION: 'session-id' }, 'win32') !== undefined, true);
    assert.equal(createPlatformRunExecutor({ WT_SESSION: 'session-id' }, 'linux'), undefined);
});

test('desktop runner status parser accepts PID, exit, and Win32 errors', () => {
    assert.deepEqual(parseDesktopRunStatus('pid=1234\nexit=7\n'), {
        pid: 1234,
        exitCode: 7,
        errorCode: undefined,
        stage: undefined
    });
    assert.deepEqual(parseDesktopRunStatus('error=5\n'), {
        pid: undefined,
        exitCode: undefined,
        errorCode: 5,
        stage: undefined
    });
});

test('desktop runner cleanup removes complete and stale groups but keeps fresh launches', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-desktop-cleanup-'));
    const completeBase = 'forja-desktop-launcher-1-complete';
    const staleBase = 'forja-desktop-launcher-1-stale';
    const freshBase = 'forja-desktop-launcher-1-fresh';
    try {
        for (const suffix of ['.exe', '.status', '.exe.done']) {
            fs.writeFileSync(path.join(directory, `${completeBase}${suffix}`), '');
        }
        for (const suffix of ['.exe', '.request', '.environment', '.status']) {
            const filePath = path.join(directory, `${staleBase}${suffix}`);
            fs.writeFileSync(filePath, '');
            fs.utimesSync(filePath, new Date(0), new Date(0));
        }
        for (const suffix of ['.exe', '.request', '.environment']) {
            fs.writeFileSync(path.join(directory, `${freshBase}${suffix}`), '');
        }

        cleanStaleDesktopRunFiles(directory);

        assert.deepEqual(fs.readdirSync(directory).sort(), [
            `${freshBase}.environment`,
            `${freshBase}.exe`,
            `${freshBase}.request`
        ]);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
