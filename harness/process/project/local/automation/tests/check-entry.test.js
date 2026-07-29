import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve('harness/process/project/local/automation/check-entry.js');

let tempDir;

function writeFixture(relativePath, content) {
  const filePath = path.join(tempDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function runCheck(...files) {
  return spawnSync(process.execPath, [scriptPath, '--files', ...files], {
    cwd: tempDir,
    encoding: 'utf8',
  });
}

describe('check-entry script', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-checks-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails a shared/ file that imports vscode namespace', () => {
    writeFixture(
      'src/qt/shared/qtCore.ts',
      `import * as vscode from 'vscode';
export function createActionPlan() {}
`
    );

    const result = runCheck('src/qt/shared/qtCore.ts');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('shared-vscode-dependency');
  });

  it('fails a cli/ file that imports from vscode', () => {
    writeFixture(
      'src/cli/index.ts',
      `import { window } from 'vscode';
export function main() {}
`
    );

    const result = runCheck('src/cli/index.ts');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('shared-vscode-dependency');
  });

  it('passes a shared/ file without vscode dependency', () => {
    writeFixture(
      'src/qt/shared/qtCore.ts',
      `import * as path from 'path';
export function createActionPlan() {}
`
    );

    const result = runCheck('src/qt/shared/qtCore.ts');

    expect(result.status).toBe(0);
  });

  it('fails extension.ts with unregistered command in package.json', () => {
    writeFixture(
      'src/extension.ts',
      `import * as vscode from 'vscode';
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('compilot.qt.newFeature', () => {})
    );
}
`
    );
    writeFixture(
      'package.json',
      JSON.stringify({
        contributes: {
          commands: [{ command: 'compilot.qt.build', title: 'Build' }],
        },
      })
    );

    const result = runCheck('src/extension.ts');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('command-not-in-package');
    expect(result.stdout).toContain('compilot.qt.newFeature');
  });

  it('passes extension.ts when all commands are in package.json', () => {
    writeFixture(
      'src/extension.ts',
      `import * as vscode from 'vscode';
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('compilot.qt.build', () => {})
    );
}
`
    );
    writeFixture(
      'package.json',
      JSON.stringify({
        contributes: {
          commands: [{ command: 'compilot.qt.build', title: 'Build' }],
        },
      })
    );

    const result = runCheck('src/extension.ts');

    expect(result.status).toBe(0);
  });

  it('limits printed issues with --max-issues', () => {
    writeFixture(
      'src/qt/shared/a.ts',
      `import * as vscode from 'vscode';
export const a = 1;
`
    );
    writeFixture(
      'src/qt/shared/b.ts',
      `import * as vscode from 'vscode';
export const b = 2;
`
    );

    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--max-issues',
        '1',
        '--files',
        'src/qt/shared/a.ts',
        'src/qt/shared/b.ts',
      ],
      {
        cwd: tempDir,
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('发现 2 个入口检查问题');
    expect(result.stdout).toContain('另有 1 个问题未显示');
  });

  it('prints only rule counts with --summary', () => {
    writeFixture(
      'src/qt/shared/qtCore.ts',
      `import * as vscode from 'vscode';
export function createActionPlan() {}
`
    );

    const result = spawnSync(
      process.execPath,
      [scriptPath, '--summary', '--files', 'src/qt/shared/qtCore.ts'],
      {
        cwd: tempDir,
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('shared-vscode-dependency: 1');
    expect(result.stdout).not.toContain('message:');
  });

  it('writes a detailed JSON report when --report is provided', () => {
    writeFixture(
      'src/qt/shared/qtCore.ts',
      `import * as vscode from 'vscode';
export function createActionPlan() {}
`
    );
    const reportPath = path.join(tempDir, 'reports/entry.json');

    const result = spawnSync(
      process.execPath,
      [
        scriptPath,
        '--summary',
        '--report',
        reportPath,
        '--files',
        'src/qt/shared/qtCore.ts',
      ],
      {
        cwd: tempDir,
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('详细报告');

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    expect(report.filesScanned).toBe(1);
    expect(report.issues[0].rule).toBe('shared-vscode-dependency');
  });

  it('ignores unrelated files before scanning entry checks', () => {
    writeFixture('README.md', '# fixture\n');

    const result = runCheck('README.md');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('没有可检查的变更文件');
  });

  it('checks files from the working tree diff with --changed', () => {
    spawnSync('git', ['init'], { cwd: tempDir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: tempDir,
      encoding: 'utf8',
    });
    spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir, encoding: 'utf8' });
    writeFixture('README.md', '# fixture\n');
    spawnSync('git', ['add', 'README.md'], { cwd: tempDir, encoding: 'utf8' });
    spawnSync('git', ['commit', '-m', 'test: initial'], { cwd: tempDir, encoding: 'utf8' });

    writeFixture(
      'src/qt/shared/qtCore.ts',
      `import * as vscode from 'vscode';
export function createActionPlan() {}
`
    );

    const result = spawnSync(process.execPath, [scriptPath, '--changed'], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('shared-vscode-dependency');
  });

  it('checks files from the staged diff with --staged', () => {
    spawnSync('git', ['init'], { cwd: tempDir, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: tempDir,
      encoding: 'utf8',
    });
    spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: tempDir, encoding: 'utf8' });
    writeFixture('README.md', '# fixture\n');
    spawnSync('git', ['add', 'README.md'], { cwd: tempDir, encoding: 'utf8' });
    spawnSync('git', ['commit', '-m', 'test: initial'], { cwd: tempDir, encoding: 'utf8' });

    writeFixture(
      'src/qt/shared/qtCore.ts',
      `import * as vscode from 'vscode';
export function createActionPlan() {}
`
    );
    spawnSync('git', ['add', 'src/qt/shared/qtCore.ts'], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    const result = spawnSync(process.execPath, [scriptPath, '--staged'], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('shared-vscode-dependency');
  });
});
