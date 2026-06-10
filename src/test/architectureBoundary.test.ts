import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

function readFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...readFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            results.push(fullPath);
        }
    }
    return results;
}

test('core source files do not import vscode', () => {
    const files = readFiles(path.join(process.cwd(), 'src', 'core'));
    const offenders = files.filter(file => {
        const source = fs.readFileSync(file, 'utf8');
        return /from ['"]vscode['"]|require\(['"]vscode['"]\)|import type \* as vscode/.test(source);
    });

    assert.deepEqual(offenders.map(file => path.relative(process.cwd(), file)), []);
});

test('CLI and shared source files do not import vscode adapters', () => {
    const roots = [
        path.join(process.cwd(), 'src', 'cli'),
        path.join(process.cwd(), 'src', 'qt', 'cli'),
        path.join(process.cwd(), 'src', 'qt', 'env'),
        path.join(process.cwd(), 'src', 'qt', 'platform', 'win'),
        path.join(process.cwd(), 'src', 'qt', 'platform', 'linux'),
        path.join(process.cwd(), 'src', 'sdk', 'cli'),
        path.join(process.cwd(), 'src', 'qt', 'shared')
    ];
    const files = [
        ...roots.flatMap(readFiles),
        path.join(process.cwd(), 'src', 'qt', 'platform', 'platformConfig.ts'),
        path.join(process.cwd(), 'src', 'qt', 'platform', 'requirements.ts'),
        path.join(process.cwd(), 'src', 'qt', 'platform', 'shellPlan.ts'),
        path.join(process.cwd(), 'src', 'sync', 'cli.ts')
    ];
    const offenders = files.filter(file => {
        const source = fs.readFileSync(file, 'utf8');
        return /from ['"].*\/vscode\/|from ['"]vscode['"]|require\(['"]vscode['"]\)/.test(source);
    });

    assert.deepEqual(offenders.map(file => path.relative(process.cwd(), file)), []);
});

test('CLI package does not include vscode logger adapter', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'build-cli.js'), 'utf8');

    assert.doesNotMatch(source, /core\/logger\.js/);
    assert.doesNotMatch(source, /['"]qt\/platform['"]/);
    assert.match(source, /core\/loggerBase\.js/);
    assert.match(source, /qt\/platform\/shellPlan\.js/);
});
