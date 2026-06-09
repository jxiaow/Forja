import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('runtime-facing source and packaging comments use Forja branding', () => {
    const files = [
        'src/sdk/sdkExtension.ts',
        'src/sdk/modules/sdkBuilder.ts',
        'src/sdk/modules/projectScanner.ts',
        'scripts/build-cli.js',
        'scripts/package-vs.js'
    ];
    const forbidden = [
        /\bSDK Pilot\b/,
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
        'docs/operations/config-panel-redesign/ui-redesign-v2.md',
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

test('current SDK CLI design docs use Forja command names', () => {
    const files = [
        'docs/superpowers/specs/2026-05-22-sdk-cli-use-design.md',
        'docs/superpowers/plans/2026-05-22-sdk-cli-use.md'
    ];
    const forbidden = [
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

test('current config migration operation docs use Forja paths and commands', () => {
    const files = [
        'docs/operations/config-migration/current-config-migration.md',
        'docs/operations/config-migration/config-migration-board.md',
        'docs/operations/config-migration/config-migration-decisions.md'
    ];
    const forbidden = [
        /~\/\.compilot/,
        /<workspace>\/\.compilot/,
        /\.compilot\//,
        /\bcompilot cleanup\b/
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

test('Qt environment source and docs do not keep legacy Qt Pilot env aliases', () => {
    const files = [
        'src/qt/shared/qtCore.ts',
        'docs/operations/cli-output-improvements/issues.md'
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

test('current CLI surfaces do not document removed --dry-run alias', () => {
    const files = [
        'src/qt/cli/args.ts',
        'src/sdk/cli/index.ts',
        'src/sync/cli.ts',
        'src/cli/cleanup.ts',
        'docs/cli-interface-spec.md',
        'docs/README-cli.md',
        'skills/forja/SKILL.md'
    ];

    const offenders: string[] = [];
    for (const file of files) {
        const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
        if (/--dry-run/.test(source)) {
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
        'src/sync/syncWatcher.ts',
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
