import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runCleanup } from '../cli/cleanup';

afterEach(() => { process.exitCode = undefined; });

function captureOutput(fn: () => void): string {
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
        fn();
        return lines.join('\n');
    } finally {
        console.log = origLog;
    }
}

test('cleanup rejects removed --dry-run alias', () => {
    const output = captureOutput(() => runCleanup(['--dry-run', '--json']));
    const parsed = JSON.parse(output);

    assert.equal(process.exitCode, 1);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.diagnostics[0].message.includes('未知参数: --dry-run'));
});
