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
        mode: 'debug',
        arch: 'x86',
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
        qmakeReminderEnabled: true,
        rccProjectPath: '',
        version: 'test',
        syncEnabled: false,
        syncSelectedServer: '',
        syncServers: [],
        syncIgnore: '.git, node_modules, out',
        syncRemotePath: '',
        syncPendingCount: 0,
        syncLastTime: ''
    };
}

test('qmake target input saves after editing is committed', () => {
    const html = getHtml(createTemplateData());

    assert.match(
        html,
        /<input id="target"[^>]*onchange="saveTarget\(\)"/,
        'target input should persist committed edits without saving on every keystroke'
    );
    assert.doesNotMatch(
        html,
        /<input id="target"[^>]*oninput="saveTarget\(\)"/,
        'target input should not write configuration for each typed character'
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
        /<input id="target"[^>]*value="DemoApp"/,
        'target input should show the parsed .pro TARGET when there is no manual override'
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

    assert.match(html, /data-default-target="DemoApp"/);
    assert.match(
        html,
        /const savedValue = value === defaultTarget \? '' : value/,
        'saveTarget should clear the override when the input still matches the parsed .pro TARGET'
    );
});

test('qmake target save skips duplicate values', () => {
    const html = getHtml(createTemplateData());

    assert.match(html, /let lastSavedTarget = null;/);
    assert.match(
        html,
        /if \(savedValue === lastSavedTarget\) \{ return; \}/,
        'saveTarget should avoid duplicate saves on unchanged values'
    );
});

test('config panel does not reload html for its own setting writes', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'configPanel', 'index.ts'), 'utf8');

    assert.doesNotMatch(
        source,
        /onDidChangeConfiguration/,
        'config panel should not rebuild the whole webview after every internal updateConfig call'
    );
});

test('config panel project name prefers qmake target override', () => {
    const html = getHtml({
        ...createTemplateData(),
        target: 'OverrideApp',
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
        /<span class="project-hero-name">OverrideApp<\/span>/,
        'config panel should show the effective qmake target as the project name'
    );
});

test('browse buttons preserve existing values when picker is cancelled', () => {
    const htmlSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'configPanel', 'configPanel.html'), 'utf8');

    assert.match(
        htmlSource,
        /function preserveBrowseInputFocus\(event\) \{\s*event\.preventDefault\(\);\s*\}/,
        'browse helper should keep the current input focused until a selection is made'
    );
    assert.match(
        htmlSource,
        /onclick="browse\('manualProPath', false\)" onmousedown="preserveBrowseInputFocus\(event\)"/,
        'manual project browse button should prevent blur-save before the picker result is known'
    );
    assert.match(
        htmlSource,
        /onclick="browse\('qtPath', true\)" onmousedown="preserveBrowseInputFocus\(event\)"/,
        'directory browse button should preserve the current value when cancelled'
    );
});
