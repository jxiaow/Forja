import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve('harness/process/export-open-source.js');

let tempDir;

function runExport(...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
}

function walkFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(filePath));
    } else if (entry.isFile()) {
      files.push(filePath);
    }
  }
  return files;
}

describe('export-open-source script', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-export-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('exports only the open-source harness subset', () => {
    const target = path.join(tempDir, 'harness', 'process');

    const result = runExport('--target', target);

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'README.zh-CN.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'docs', 'workflow-reference.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'docs', 'maintaining.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'examples', 'bug-fix-gate-output.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'project', '_template', 'local.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'project', 'local.md'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'project', 'local'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'AGENTS.template.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'automation', 'tests'))).toBe(false);
    expect(fs.existsSync(path.join(target, 'project', 'create-adapter.test.js'))).toBe(false);

    const exportedPaths = walkFiles(target).map(file => file.split(path.sep).join('/'));
    expect(exportedPaths.some(file => file.includes('/project/local/'))).toBe(false);
    expect(exportedPaths.some(file => file.endsWith('.test.js'))).toBe(false);
  });

  it('refuses to overwrite an existing export target', () => {
    const target = path.join(tempDir, 'existing');
    fs.mkdirSync(target);

    const result = runExport('--target', target);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('拒绝覆盖');
  });

  it('prints usage for help', () => {
    const result = runExport('--help');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('export-open-source.js');
    expect(result.stdout).toContain('dist/agent-harness');
  });

  it('uses the root dist export path by default', () => {
    const result = runExport('--help');

    expect(result.stdout).not.toContain('.tmp/harness-open-source');
    expect(result.stdout).not.toContain('harness-open-source/harness/process');
  });
});
