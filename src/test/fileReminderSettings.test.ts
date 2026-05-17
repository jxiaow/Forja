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
        selectedProject: '',
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
        syncIgnore: '.git, node_modules, out',
        branchSyncEnabled: false
    };
}

test('config panel html includes file reminder toggles', () => {
    const html = getHtml(createTemplateData());

    assert.match(html, /id="fileSyncPromptEnabled"/);
    assert.match(html, /id="qmakeReminderEnabled"/);
});

test('pri watcher consults reminder settings before showing prompts', () => {
    const watcherSource = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'project', 'priWatcher.ts'), 'utf8');

    assert.match(watcherSource, /getFileSyncPromptEnabled/);
    assert.match(watcherSource, /getQmakeReminderEnabled/);
});
