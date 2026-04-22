import test from 'node:test';
import assert from 'node:assert/strict';
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
        qmakeTarget: 'MyApp',
        isWin: true,
        autoDevShell: '',
        autoQtPath: '',
        qtPath: '',
        designerPath: '',
        qtSourcePath: '',
        manualProPath: '',
        fileSyncPromptEnabled: true,
        qmakeReminderEnabled: true,
        version: 'test'
    };
}

test('qmake target input saves while typing so reopening can restore it', () => {
    const html = getHtml(createTemplateData());

    assert.match(
        html,
        /<input id="qmakeTarget"[^>]*oninput="saveQmakeTarget\(\)"/,
        'qmakeTarget input should persist edits on input instead of waiting for blur only'
    );
});
