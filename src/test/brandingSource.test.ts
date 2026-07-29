import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('runtime-facing source and packaging comments use Forja branding', () => {
    const files = [
        'src/cpp/cppExtension.ts',
        'src/cpp/modules/cppBuilder.ts',
        'src/cpp/modules/projectScanner.ts',
        'scripts/build-cli.js',
        'scripts/package-vs.js'
    ];
    const forbidden = [
        /\bC\+\+ Pilot\b/,
        /\bCompilot\b/,
        /\bcompilot\b/
    ];

    const offenders: string[] = [];
    for (const file of files) {
        const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
        if (forbidden.some(pattern => pattern.test(source))) {
            offenders.push(file);
        }
    }

    assert.deepEqual(offenders, []);
});

test('current examples do not use legacy client project names', () => {
    const files = [
        'docs/cli-interface-spec.md',
        'src/ui/configPanel/pages/project.ts',
        'src/ui/configPanel/configPanel.html',
        'src/test/settingsIO.test.ts',
        'src/test/configPanelHtml.test.ts',
        'src/test/qtCore.test.ts',
        'src/test/localState.test.ts'
    ];
    const forbidden = new RegExp(['X', 'Y', 'W', 'i', 'n', 'Q', 'T'].join(''), 'i');

    const offenders: string[] = [];
    for (const file of files) {
        const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
        if (forbidden.test(source)) {
            offenders.push(file);
        }
    }

    assert.deepEqual(offenders, []);
});

test('Qt environment source and docs do not keep legacy Qt Pilot env aliases', () => {
    const files = [
        'src/qt/shared/qtCore.ts'
    ];
    const forbidden = [
        /\bQT_PILOT_QT_PATH\b/,
        /\bQT_PILOT_VS_DEV_SHELL\b/
    ];

    const offenders: string[] = [];
    for (const file of files) {
        const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
        if (forbidden.some(pattern => pattern.test(source))) {
            offenders.push(file);
        }
    }

    assert.deepEqual(offenders, []);
});

test('production source does not keep selected legacy compatibility helpers', () => {
    const files = [
        'src/qt/project/pinnedProject.ts',
        'src/core/serverStore.ts',
        'src/sync/resolver.ts',
        'src/sync/cli.ts',
        'src/vscode/syncWatcher.ts',
        'src/ui/configPanel/templateData.ts',
        'src/core/syncState.ts'
    ];
    const forbidden = [
        /getServerByName/,
        /without target context/,
        /\.name === project\.selectedServer/,
        /\.name === sync\.selectedServer/,
        /JSON\.parse\(value\)/
    ];

    const offenders: string[] = [];
    for (const file of files) {
        const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
        if (forbidden.some(pattern => pattern.test(source))) {
            offenders.push(file);
        }
    }

    assert.deepEqual(offenders, []);
});
