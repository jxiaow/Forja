import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { describe, expect, it } from 'vitest';

const scriptPath = path.resolve('harness/process/project/local/automation/check-harness.js');

describe('check-harness script', () => {
  it('is exposed as the harness:check npm script', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));

    expect(packageJson.scripts['harness:check']).toBe(
      'node harness/process/project/local/automation/check-harness.js --summary --max-issues 3'
    );
    expect(packageJson.scripts['harness:check:staged']).toBe(
      'node harness/process/project/local/automation/check-harness.js --staged --summary --max-issues 3'
    );
  });

  it('runs staged harness checks from lint-staged after formatting', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));

    expect(packageJson['lint-staged']['*.{js,vue}']).toContain('npm run harness:check:staged --');
    expect(packageJson['lint-staged']['*.{json,md}']).toContain('npm run harness:check:staged --');
  });

  it('runs process and entry checks in changed mode by default', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check-process.js --changed');
    expect(result.stdout).toContain('check-entry.js --changed');
  });

  it('runs entry checks in staged mode when requested', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--staged'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check-process.js --staged');
    expect(result.stdout).toContain('check-entry.js --staged');
  });

  it('passes max issue budget to child checks', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--max-issues', '2'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check-process.js --changed --max-issues 2');
    expect(result.stdout).toContain('check-entry.js --changed --max-issues 2');
  });

  it('passes summary mode to child checks', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--summary'], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check-process.js --changed --summary');
    expect(result.stdout).toContain('check-entry.js --changed --summary');
  });

  it('passes a default report path to child checks', () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'check-process.js --changed --report .tmp/harness-check-report.json'
    );
    expect(result.stdout).toContain(
      'check-entry.js --changed --report .tmp/harness-check-report.json'
    );
  });

  it('ignores extra file arguments appended by lint-staged', () => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, '--staged', '--summary', '--max-issues', '3', 'package.json', 'README.md'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('check-entry.js --staged --summary --max-issues 3');
  });

  it('forwards explicit targets outside staged mode', () => {
    const result = spawnSync(
      process.execPath,
      [scriptPath, '--summary', '--max-issues', '3', 'AGENTS.md', 'README.md'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'check-process.js AGENTS.md README.md --summary --max-issues 3'
    );
    expect(result.stdout).toContain(
      'check-entry.js --files AGENTS.md README.md --summary --max-issues 3'
    );
  });
});
