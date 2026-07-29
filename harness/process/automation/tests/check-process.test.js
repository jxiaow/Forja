import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scriptPath = path.resolve('harness/process/automation/check-process.js');

let tempDir;

function writeFixture(relativePath, content) {
  const filePath = path.join(tempDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function runCheck(...targets) {
  return spawnSync(process.execPath, [scriptPath, ...targets], {
    cwd: tempDir,
    encoding: 'utf8',
  });
}

describe('check-process script', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'process-checks-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('fails final closeout without verification evidence and risk fields', () => {
    writeFixture(
      'notes.md',
      `# Notes

final closeout
- 结果：完成了流程优化
`
    );

    const result = runCheck('notes.md');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('final-closeout-evidence');
    expect(result.stdout).toContain('缺少验证');
    expect(result.stdout).toContain('缺少未验证');
    expect(result.stdout).toContain('缺少风险');
  });

  it('passes final closeout when result, verification, unverified items, and risk are present', () => {
    writeFixture(
      'delivery.md',
      `# Delivery

final closeout
- 结果：已完成流程优化
- 验证：node harness/process/automation/check-process.js --changed --summary
- 未验证：未接入 CI
- 风险：文本启发式可能有误报
`
    );

    const result = runCheck('delivery.md');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('未发现流程检查问题');
  });

  it('fails when final closeout appears while work is still in progress', () => {
    writeFixture(
      'board.md',
      `# Board

- 状态：in_progress

final closeout
- 结果：完成
- 验证：静态检查通过
- 未验证：无
- 风险：无
`
    );

    const result = runCheck('board.md');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('in-progress-final-closeout');
  });

  it('fails final closeout that adds non-blocking next-step suggestions', () => {
    writeFixture(
      'delivery.md',
      `# Delivery

final closeout
- 结果：完成
- 验证：node harness/process/automation/check-process.js --changed --summary 通过
- 未验证：无
- 风险：无
- 下一步：可以继续接入更多检查
`
    );

    const result = runCheck('delivery.md');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('final-closeout-next-step');
  });

  it('fails final closeout that packages actionable work as remaining risk', () => {
    writeFixture(
      'delivery.md',
      `# Delivery

final closeout
- 结果：完成
- 验证：node harness/process/automation/check-process.js --changed --summary 通过
- 未验证：无
- 风险：还有一个可继续修复的问题，后续可以优化取消逻辑
`
    );

    const result = runCheck('delivery.md');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('final-closeout-actionable-risk');
  });

  it('allows next action text when final closeout is blocked', () => {
    writeFixture(
      'blocked.md',
      `# Blocked

final closeout
- 结果：暂停
- 验证：已检查当前路径
- 未验证：需授权命令
- 风险：缺关键输入
- 下一步：等待授权后继续
- 阻塞：需要用户授权
`
    );

    const result = runCheck('blocked.md');

    expect(result.status).toBe(0);
  });

  it('fails final closeout that adds boilerplate no-risk text', () => {
    writeFixture(
      'delivery.md',
      `# Delivery

final closeout
- 结果：完成
- 验证：node harness/process/automation/check-process.js --changed --summary 通过
- 未验证：无
- 风险：无
`
    );

    const result = runCheck('delivery.md');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('final-closeout-risk-boilerplate');
  });

  it('fails process docs that require next-step fields in final closeout', () => {
    writeFixture(
      'harness/process/automation/rule-to-check-map.md',
      `# Rule Map

final closeout 默认必须包含结果、验证、风险和下一步字段。
`
    );

    const result = runCheck('harness/process');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('final-closeout-next-step-conflict');
  });

  it('fails docs that show multiple gate outputs on one line', () => {
    writeFixture(
      'harness/process/README.md',
      `# Process

Requirement gate：范围明确。Design gate：改文档。Implementation gate：补脚本。
`
    );

    const result = runCheck('harness/process');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('gate-output-one-line');
  });

  it('fails docs that put task type and gate output on one line', () => {
    writeFixture(
      'harness/process/README.md',
      `# Process

任务类型：重构 Requirement gate：范围明确
`
    );

    const result = runCheck('harness/process');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('gate-output-one-line');
  });

  it('fails long-running notes without checklist, execution order, and current work package', () => {
    writeFixture(
      'plan.md',
      `# Plan

任务尺寸：long-running

这次会调整 workspace 和目录迁移。
`
    );

    const result = runCheck('plan.md');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('long-running-plan');
    expect(result.stdout).toContain('缺少阶段级 checklist');
    expect(result.stdout).toContain('缺少执行顺序');
    expect(result.stdout).toContain('缺少当前工作包');
  });

  it('fails operation-state documents placed under docs/development', () => {
    writeFixture(
      'docs/development/remediation-board.md',
      `# Remediation Board

- [ ] WP-01
`
    );

    const result = runCheck('docs');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('operation-doc-location');
    expect(result.stdout).toContain('docs/operations/');
  });

  it('limits printed issues with --max-issues', () => {
    writeFixture(
      'a.md',
      `final closeout
- 结果：完成
`
    );
    writeFixture(
      'b.md',
      `final closeout
- 结果：完成
`
    );

    const result = spawnSync(process.execPath, [scriptPath, '--max-issues', '1', tempDir], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('发现 2 个流程检查问题');
    expect(result.stdout).toContain('另有 1 个问题未显示');
  });

  it('prints only rule counts with --summary', () => {
    writeFixture(
      'a.md',
      `final closeout
- 结果：完成
`
    );

    const result = spawnSync(process.execPath, [scriptPath, '--summary', tempDir], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('final-closeout-evidence: 1');
    expect(result.stdout).not.toContain('message:');
  });

  it('writes a detailed JSON report when --report is provided', () => {
    writeFixture(
      'a.md',
      `final closeout
- 结果：完成
`
    );
    const reportPath = path.join(tempDir, 'reports/process.json');

    const result = spawnSync(
      process.execPath,
      [scriptPath, '--summary', '--report', reportPath, tempDir],
      {
        cwd: tempDir,
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('详细报告');

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    expect(report.filesScanned).toBe(1);
    expect(report.issues[0].rule).toBe('final-closeout-evidence');
  });

  it('checks markdown files from the working tree diff with --changed', () => {
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
      'AGENTS.md',
      `# Agents

final closeout
- 结果：完成
`
    );
    writeFixture(
      'notes.txt',
      `final closeout
- 结果：不应扫描非 Markdown
`
    );

    const result = spawnSync(process.execPath, [scriptPath, '--changed'], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('AGENTS.md');
    expect(result.stdout).toContain('final-closeout-evidence');
    expect(result.stdout).not.toContain('notes.txt');
  });

  it('checks markdown files from the staged diff with --staged', () => {
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
      'harness/process/notes.md',
      `# Notes

final closeout
- 结果：完成
`
    );
    spawnSync('git', ['add', 'harness/process/notes.md'], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    const result = spawnSync(process.execPath, [scriptPath, '--staged'], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('harness/process/notes.md');
    expect(result.stdout).toContain('final-closeout-evidence');
  });

  it('does not flag process rule documentation that only describes check keywords', () => {
    writeFixture(
      'harness/process/gates/delivery-gate.md',
      `# Delivery Gate

Only output final closeout when work is not in_progress.
long-running tasks need checklist examples.
continuation means “继续 / 开始 / 接着做 / 按计划执行” inherits the active stage.
If a board or checklist exists, read it before closeout.
Do not treat a single 工作包完成当最终完成.
`
    );

    const result = runCheck('harness/process');

    expect(result.status).toBe(0);
  });

  it('fails README when final closeout target types are incomplete', () => {
    writeFixture(
      'harness/process/README.md',
      `# AgentHarness

final closeout 前必须先判定当前目标类型：

- single-task
- continuation
`
    );

    const result = runCheck('harness/process/README.md');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('closeout-target-types');
    expect(result.stdout).toContain('staged/ongoing');
    expect(result.stdout).toContain('explicit-closeout');
  });

  it('passes README when all final closeout target types are present', () => {
    writeFixture(
      'harness/process/README.md',
      `# AgentHarness

final closeout 前必须先判定当前目标类型：

- single-task
- staged/ongoing
- continuation
- explicit-closeout
`
    );

    const result = runCheck('harness/process/README.md');

    expect(result.status).toBe(0);
  });

  it('fails Delivery gate when continuation closeout constraints are missing', () => {
    writeFixture(
      'harness/process/gates/delivery-gate.md',
      `# Delivery Gate

## Final Closeout Conditions

- single-task
- staged/ongoing
- explicit-closeout
`
    );

    const result = runCheck('harness/process/gates/delivery-gate.md');

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('delivery-continuation-closeout');
    expect(result.stdout).toContain('continuation');
  });

  it('passes Delivery gate when continuation and board closeout constraints are present', () => {
    writeFixture(
      'harness/process/gates/delivery-gate.md',
      `# Delivery Gate

## Final Closeout Conditions

- continuation：用户只说“继续 / 开始 / 接着做 / 按计划执行”时继承上一个活动阶段目标。
- 若使用执行板或 checklist，已读取它并确认无下一可执行动作。
- 不能把工作包完成当最终完成。
`
    );

    const result = runCheck('harness/process/gates/delivery-gate.md');

    expect(result.status).toBe(0);
  });

  it('does not flag stable change logs that mention boards or matrices', () => {
    writeFixture(
      'docs/development/changes/2026-04-23-process-closeout-checkrails.md',
      `# Process Closeout Checkrails

This change explains why an execution board can prevent early closeout.
`
    );

    const result = runCheck('docs/development/changes');

    expect(result.status).toBe(0);
  });

  it('is exposed as the process:check npm script', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));

    expect(packageJson.scripts['process:check']).toBe(
      'node harness/process/automation/check-process.js'
    );
  });

  it('documents changed and staged modes in help output', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--help'], {
      cwd: tempDir,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--changed');
    expect(result.stdout).toContain('--staged');
  });
});
