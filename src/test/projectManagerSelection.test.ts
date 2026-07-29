import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

test('project selection tolerates unreadable pro files by falling back to path labels', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src', 'qt', 'project', 'projectManager.ts'), 'utf8');

    assert.match(source, /try\s*\{\s*const info = parseProFile\(fullPath\)/);
    assert.match(source, /catch\s*\{\s*logger\.warn\(`解析 \.pro 失败, 使用路径显示: \$\{fullPath\}`\)/);
    assert.match(source, /label = getProjectSelectionLabel\(null, rel/);
});
