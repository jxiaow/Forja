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
        qmakeTarget: '',
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

test('qmake target input falls back to current project target when override is empty', () => {
    const html = getHtml({
        ...createTemplateData(),
        project: {
            proPath: 'C:\\workspace\\demo\\demo.pro',
            proFile: 'demo.pro',
            projectDir: 'demo',
            target: 'DemoApp',
            qtModules: ['core'],
            defines: []
        }
    });

    assert.match(
        html,
        /<input id="qmakeTarget"[^>]*value="DemoApp"/,
        'qmakeTarget input should show the parsed .pro TARGET when there is no manual override'
    );
});

test('qmake target save keeps fallback display from being persisted as a manual override', () => {
    const html = getHtml({
        ...createTemplateData(),
        project: {
            proPath: 'C:\\workspace\\demo\\demo.pro',
            proFile: 'demo.pro',
            projectDir: 'demo',
            target: 'DemoApp',
            qtModules: ['core'],
            defines: []
        }
    });

    assert.match(html, /data-default-qmake-target="DemoApp"/);
    assert.match(
        html,
        /function saveQmakeTarget\(\) \{[\s\S]*value: value === defaultTarget \? '' : value[\s\S]*\}/,
        'saveQmakeTarget should clear the override when the input still matches the parsed .pro TARGET'
    );
});
