import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { extractRemoteProblemLines, mapRemoteProblemPath } from '../remote/vscode/problemMatcher';

test('extractRemoteProblemLines parses gcc clang and msvc diagnostics', () => {
    const result = extractRemoteProblemLines({
        remote: {
            result: {
                errors: [
                    '/remote/ws/app/src/main.cpp:12:5: error: expected ;',
                    '/remote/ws/app/src/main.cpp:13:7: warning: unused variable',
                    'C:/remote/ws/app/src/main.cpp(14,9): error C2143: syntax error'
                ]
            }
        }
    });

    assert.equal(result.length, 3);
    assert.deepEqual(result.map(item => item.line), [12, 13, 14]);
    assert.deepEqual(result.map(item => item.column), [5, 7, 9]);
    assert.deepEqual(result.map(item => item.severity), ['error', 'warning', 'error']);
    assert.match(result[0].message, /expected/);
});

test('extractRemoteProblemLines deduplicates errors from json and streams', () => {
    const line = '/remote/ws/app/src/main.cpp:12:5: error: expected ;';
    const result = extractRemoteProblemLines({
        remote: {
            result: { errors: [line] },
            stdout: line + '\nnot a diagnostic',
            stderr: line
        }
    });

    assert.equal(result.length, 1);
});

test('mapRemoteProblemPath only maps existing files inside workspace', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'compilot-problems-'));
    const sourceDir = path.join(workspace, 'app', 'src');
    fs.mkdirSync(sourceDir, { recursive: true });
    const source = path.join(sourceDir, 'main.cpp');
    fs.writeFileSync(source, 'int main() { return 0; }\n');

    assert.equal(mapRemoteProblemPath(workspace, '/remote/ws', '/remote/ws/app/src/main.cpp'), source);
    assert.equal(mapRemoteProblemPath(workspace, '/remote/ws', 'app/src/main.cpp'), source);
    assert.equal(mapRemoteProblemPath(workspace, '/remote/ws', '/other/ws/app/src/main.cpp'), null);
    assert.equal(mapRemoteProblemPath(workspace, '/remote/ws', '../app/src/main.cpp'), null);
    assert.equal(mapRemoteProblemPath(workspace, '/remote/ws', '/remote/ws/app/src/missing.cpp'), null);
});
