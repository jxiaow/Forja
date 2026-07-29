import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve('harness/process/project/create-adapter.js');

let tempDir;

function runCreateAdapter(...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
}

describe('create-adapter script', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-scaffold-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates an adapter from the generic template', () => {
    const target = path.join(tempDir, 'project-adapter');

    const result = runCreateAdapter('--target', target, '--name', 'Acme Adapter');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('adapter created:');
    expect(fs.existsSync(path.join(target, 'local.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'rules', 'entrypoints.md'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'automation', 'README.md'))).toBe(true);
    expect(fs.readFileSync(path.join(target, 'local.md'), 'utf8')).toContain('# Acme Adapter');
  });

  it('refuses to overwrite an existing target', () => {
    const target = path.join(tempDir, 'existing-adapter');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep.txt'), 'keep', 'utf8');

    const result = runCreateAdapter('--target', target);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('拒绝覆盖');
    expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('prints usage for help', () => {
    const result = runCreateAdapter('--help');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('create-adapter.js');
  });

  it('fails on unknown arguments', () => {
    const result = runCreateAdapter('--unknown');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('未知参数');
  });
});
