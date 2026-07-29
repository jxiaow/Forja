import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('compile copy-html step is cross-platform node script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

    assert.equal(pkg.scripts['copy-html'], 'node scripts/copy-html.js');
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
    assert.match(source, /'core\/sshTransport\.js'/);
    assert.doesNotMatch(source, /qt\/sync/);
});
