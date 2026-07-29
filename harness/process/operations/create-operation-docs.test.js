import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve('harness/process/operations/create-operation-docs.js');

let tempDir;

function runCreateOperationDocs(...args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
}

describe('create-operation-docs script', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'operation-docs-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates current, board, matrix, and decisions docs', () => {
    const operationsDir = path.join(tempDir, 'docs', 'operations');

    const result = runCreateOperationDocs('Repo Restructure', '--dir', operationsDir);

    expect(result.status).toBe(0);
    const targetDir = path.join(operationsDir, 'repo-restructure');
    expect(fs.existsSync(path.join(targetDir, 'current-repo-restructure.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'repo-restructure-board.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'repo-restructure-matrix.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'repo-restructure-decisions.md'))).toBe(true);
    expect(fs.readFileSync(path.join(targetDir, 'repo-restructure-board.md'), 'utf8')).toContain(
      'REPO_RESTRUCTURE-01'
    );
  });

  it('refuses to overwrite an existing initiative directory', () => {
    const operationsDir = path.join(tempDir, 'docs', 'operations');
    fs.mkdirSync(path.join(operationsDir, 'existing'), { recursive: true });

    const result = runCreateOperationDocs('existing', '--dir', operationsDir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('目标目录已存在');
  });

  it('prints usage for help', () => {
    const result = runCreateOperationDocs('--help');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('create-operation-docs.js');
  });
});
