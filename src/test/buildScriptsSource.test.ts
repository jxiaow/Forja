import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('compile copy-html step is cross-platform node script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

    assert.equal(pkg.scripts['copy-html'], 'node scripts/copy-html.js');
});

test('Windows desktop launcher has an explicit build and stale-binary check', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const copySource = fs.readFileSync(path.join(process.cwd(), 'scripts', 'copy-html.js'), 'utf8');
    const buildSource = fs.readFileSync(path.join(process.cwd(), 'scripts', 'build-windows-launcher.js'), 'utf8');

    assert.equal(pkg.scripts['build:native:windows'], 'node scripts/build-windows-launcher.js');
    assert.match(copySource, /sourceSha256/);
    assert.match(copySource, /binarySha256/);
    assert.match(buildSource, /desktopLauncher\.manifest\.json/);
});

test('compile cleans stale out files before TypeScript emits', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'clean-out.js'), 'utf8');

    assert.equal(pkg.scripts['clean-out'], 'node scripts/clean-out.js');
    assert.equal(pkg.scripts['compile'], 'npm run sync-version && npm run clean-out && tsc -p ./ && npm run copy-html');
    assert.match(source, /rmSync\(outDir, \{ recursive: true, force: true \}\)/);
});

test('bump-version keeps package-lock root version in sync', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'bump-version.js'), 'utf8');

    assert.match(source, /package-lock\.json/);
    assert.match(source, /lock\.version = pkg\.version/);
    assert.match(source, /lock\.packages\[''\]\.version = pkg\.version/);
});


test('cli package includes generic sync cli and shared ssh transport', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'build-cli.js'), 'utf8');

    assert.match(source, /'sync\/cli\.js'/);
    assert.match(source, /'core\/syncFileSelection\.js'/);
    assert.match(source, /'core\/sshTransport\.js'/);
    assert.match(source, /'qt\/platform\/runExecutor\.js'/);
    assert.doesNotMatch(source, /qt\/sync/);
});
