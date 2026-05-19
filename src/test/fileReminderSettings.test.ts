import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { getHtml, TemplateData } from '../ui/configPanel/template';

function createTemplateData(): TemplateData {
    return {
        env: null,
        project: null,
        vsDevShellPath: '',
        pinnedProject: '',
        cStandard: 'c11',
        cppStandard: 'c++17',
        scanExcludeDirs: '',
        target: '',
        isWin: true,
        autoDevShell: '',
        autoQtPath: '',
        qtPath: '',
        designerPath: '',
        qtSourcePath: '',
        manualProPath: '',
        fileSyncPromptEnabled: true,
        qmakeReminderEnabled: false,
        rccProjectPath: '',
        version: 'test',
        syncEnabled: false,
        syncSelectedServer: '',
        syncServers: [],
        syncIgnore: '.git, node_modules, out'
    };
}

test('config panel html includes file reminder toggles with correct state', () => {
    const dataOn = createTemplateData();
    dataOn.fileSyncPromptEnabled = true;
    dataOn.qmakeReminderEnabled = true;
    const htmlOn = getHtml(dataOn);

    assert.match(htmlOn, /id="fileSyncPromptEnabled"/);
    assert.match(htmlOn, /id="qmakeReminderEnabled"/);
    assert.match(htmlOn, /id="fileSyncPromptEnabled"[^>]*checked/);
    assert.match(htmlOn, /id="qmakeReminderEnabled"[^>]*checked/);

    const dataOff = createTemplateData();
    dataOff.fileSyncPromptEnabled = false;
    dataOff.qmakeReminderEnabled = false;
    const htmlOff = getHtml(dataOff);

    assert.match(htmlOff, /id="fileSyncPromptEnabled"/);
    assert.match(htmlOff, /id="qmakeReminderEnabled"/);
    assert.doesNotMatch(htmlOff, /id="fileSyncPromptEnabled"[^>]*checked/);
    assert.doesNotMatch(htmlOff, /id="qmakeReminderEnabled"[^>]*checked/);
});

test('pri watcher guards prompts with reminder settings (early return)', () => {
    const watcherSource = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'project', 'priWatcher.ts'), 'utf8');

    // Verify the settings are imported
    assert.match(watcherSource, /import\s*\{[^}]*getFileSyncPromptEnabled[^}]*\}\s*from/);
    assert.match(watcherSource, /import\s*\{[^}]*getQmakeReminderEnabled[^}]*\}\s*from/);

    // Verify they are used as early-return guards (not just referenced)
    assert.match(watcherSource, /if\s*\(\s*!getFileSyncPromptEnabled\(\)\s*\)\s*\{\s*return/);
    assert.match(watcherSource, /if\s*\(\s*!getQmakeReminderEnabled\(\)\s*\)\s*\{\s*return/);
});
