import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectJomSync } from '../qt/platform/win/envDetector';

test('Windows env detection keeps scanning candidates when manual paths are configured', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'platform', 'win', 'envDetector.ts'), 'utf8');

    assert.match(source, /const vsCandidatesPromise = scanVS\(\)/);
    assert.doesNotMatch(source, /const vsCandidatesPromise = manualVsPath[\s\S]*Promise\.resolve/);
    assert.match(source, /const qtPromise = detectQt\(manualQtPath\)/);
    assert.match(source, /const manualVs = manualVsPath/);
});

test('synchronous jom detection checks PATH without invoking a shell', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-jom-path-'));
    const jomPath = path.join(tempDir, 'jom.exe');
    const oldPath = process.env.PATH;
    fs.writeFileSync(jomPath, '');
    process.env.PATH = tempDir;

    try {
        assert.equal(detectJomSync(), jomPath);
    } finally {
        process.env.PATH = oldPath;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
