import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanRccTargets } from '../qt/shared/rccResolver';
import { setOutputWriter, setSilent } from '../core/loggerBase';

function makeFilePath(): { dir: string; filePath: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forja-rcc-resolver-'));
    const filePath = path.join(dir, 'not-a-directory.txt');
    fs.writeFileSync(filePath, 'not a directory', 'utf8');
    return { dir, filePath };
}

test('scanRccTargets routes scan failure warnings through logger output writer', () => {
    const { dir, filePath } = makeFilePath();
    const lines: string[] = [];
    const consoleWarnings: unknown[] = [];
    const oldConsoleWarn = console.warn;
    console.warn = (...args: unknown[]) => { consoleWarnings.push(args); };

    setOutputWriter(line => lines.push(line));
    try {
        const targets = scanRccTargets(filePath);
        assert.deepEqual(targets, []);
    } finally {
        setOutputWriter(null);
        console.warn = oldConsoleWarn;
        fs.rmSync(dir, { recursive: true, force: true });
    }

    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[WARN\]/);
    assert.match(lines[0], /scanRccTargets failed/);
    assert.deepEqual(consoleWarnings, []);
});

test('scanRccTargets suppresses scan failure warnings in silent mode', () => {
    const { dir, filePath } = makeFilePath();
    const lines: string[] = [];
    const consoleWarnings: unknown[] = [];
    const oldConsoleWarn = console.warn;
    console.warn = (...args: unknown[]) => { consoleWarnings.push(args); };

    setSilent(true);
    setOutputWriter(line => lines.push(line));
    try {
        const targets = scanRccTargets(filePath);
        assert.deepEqual(targets, []);
    } finally {
        setOutputWriter(null);
        setSilent(false);
        console.warn = oldConsoleWarn;
        fs.rmSync(dir, { recursive: true, force: true });
    }

    assert.deepEqual(lines, []);
    assert.deepEqual(consoleWarnings, []);
});
