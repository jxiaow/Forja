#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const excludedDirs = new Set(['node_modules', 'dist', 'target', '.git']);

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isMarkdownFile(filePath) {
  return filePath.endsWith('.md');
}

function collectMarkdownFiles(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return isMarkdownFile(targetPath) ? [targetPath] : [];
  }

  if (!stat.isDirectory()) {
    return [];
  }

  const files = [];
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirs.has(entry.name)) {
      continue;
    }

    const childPath = path.join(targetPath, entry.name);
    files.push(...collectMarkdownFiles(childPath));
  }

  return files;
}

function hasAny(content, patterns) {
  return patterns.some(pattern => pattern.test(content));
}

function buildIssue(rule, file, message) {
  return { rule, file, message };
}

function hasFinalCloseoutMarker(content) {
  return /^#{0,6}\s*final closeout\s*$/im.test(content);
}

function checkFinalCloseoutEvidence(relativePath, content) {
  if (!hasFinalCloseoutMarker(content)) {
    return [];
  }

  const missing = [];
  if (!hasAny(content, [/结果[:：]/, /已完成[:：]/])) {
    missing.push('缺少结果');
  }
  if (!hasAny(content, [/验证[:：]/, /已验证[:：]/, /最近一次关键验证命令/])) {
    missing.push('缺少验证');
  }
  if (!hasAny(content, [/未验证[:：]/, /未验证项/])) {
    missing.push('缺少未验证');
  }
  if (!hasAny(content, [/风险[:：]/, /剩余风险/])) {
    missing.push('缺少风险');
  }

  if (missing.length === 0) {
    return [];
  }

  return [
    buildIssue(
      'final-closeout-evidence',
      relativePath,
      `final closeout 缺少证据锚点: ${missing.join('、')}`
    ),
  ];
}

function checkInProgressFinalCloseout(relativePath, content) {
  if (!hasFinalCloseoutMarker(content)) {
    return [];
  }

  if (!/\bin_progress\b|进行中/.test(content)) {
    return [];
  }

  return [
    buildIssue(
      'in-progress-final-closeout',
      relativePath,
      'in_progress / 进行中状态下不能输出 final closeout'
    ),
  ];
}

function checkFinalCloseoutNextStep(relativePath, content) {
  if (!hasFinalCloseoutMarker(content)) {
    return [];
  }

  if (!/下一步[:：]|next step[:：]/i.test(content)) {
    return [];
  }

  if (/阻塞[:：]|需要用户授权|缺关键输入|真实阻塞|等待授权|blocked/i.test(content)) {
    return [];
  }

  return [
    buildIssue(
      'final-closeout-next-step',
      relativePath,
      'final closeout 不应添加非阻塞的下一步建议；有可执行项时应继续执行'
    ),
  ];
}

function checkFinalCloseoutActionableRisk(relativePath, content) {
  if (!hasFinalCloseoutMarker(content)) {
    return [];
  }

  if (/阻塞[:：]|需要用户授权|缺关键输入|真实阻塞|等待授权|blocked/i.test(content)) {
    return [];
  }

  const riskLines = content
    .split(/\r?\n/)
    .filter(line => /风险[:：]|剩余风险/.test(line))
    .join('\n');
  if (
    !/(可继续|继续(修|处理|推进|优化|验证)|可修|可处理|可优化|可验证|还能|还可以|待修|待处理|待优化|后续可以|下一步)/i.test(
      riskLines
    )
  ) {
    return [];
  }

  return [
    buildIssue(
      'final-closeout-actionable-risk',
      relativePath,
      'final closeout 不能把可继续处理的事项包装成剩余风险；应继续执行或说明真实阻塞'
    ),
  ];
}

function checkFinalCloseoutRiskBoilerplate(relativePath, content) {
  if (!hasFinalCloseoutMarker(content)) {
    return [];
  }

  const hasNoUnverified = /未验证[:：]\s*(无|无未验证|none|n\/a)(?:\s|$)/i.test(content);
  const hasNoRisk = /风险[:：]\s*(无|无风险|未发现新的剩余风险|none|n\/a)(?:\s|$)/i.test(content);
  if (!hasNoUnverified || !hasNoRisk) {
    return [];
  }

  return [
    buildIssue(
      'final-closeout-risk-boilerplate',
      relativePath,
      '无未验证项且无真实风险时，不要为凑格式输出风险样板话'
    ),
  ];
}

function checkFinalCloseoutNextStepConflict(relativePath, content) {
  if (!/final closeout/i.test(content)) {
    return [];
  }

  if (
    !/(final closeout|收口)[^\n。；;]*(必须|默认应|默认必须|至少)[^\n。；;]*(下一步|next step)/i.test(
      content
    )
  ) {
    return [];
  }

  return [
    buildIssue(
      'final-closeout-next-step-conflict',
      relativePath,
      '不要把“下一步”写成 final closeout 的必填项；未完成时继续执行或记录阻塞'
    ),
  ];
}

function checkGateOutputOneLine(relativePath, content) {
  const issues = [];
  const gatePattern = /\b(Requirement|Design|Implementation|Verification|Delivery)\s+gate\s*[:：]/g;
  const taskTypePattern = /任务类型\s*[:：]/;
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const matches = line.match(gatePattern) || [];
    if (matches.length < 2 && !(taskTypePattern.test(line) && matches.length > 0)) {
      return;
    }

    issues.push(
      buildIssue(
        'gate-output-one-line',
        relativePath,
        `第 ${index + 1} 行包含挤在一起的任务类型或 gate 输出；任务类型和不同 gate 必须换行分隔`
      )
    );
  });

  return issues;
}

function checkLongRunningPlan(relativePath, content) {
  if (!/任务尺寸[:：]\s*`?long-running`?|Size[:：]\s*`?long-running`?/i.test(content)) {
    return [];
  }

  const missing = [];
  if (!/- \[[ x-]\]/.test(content)) {
    missing.push('缺少阶段级 checklist');
  }
  if (!/执行顺序|阶段顺序/.test(content)) {
    missing.push('缺少执行顺序');
  }
  if (!/当前工作包|第一工作包|current work package/i.test(content)) {
    missing.push('缺少当前工作包');
  }

  if (missing.length === 0) {
    return [];
  }

  return [
    buildIssue(
      'long-running-plan',
      relativePath,
      `long-running 任务缺少阶段计划字段: ${missing.join('、')}`
    ),
  ];
}

function checkOperationDocLocation(relativePath, content) {
  const normalized = normalizePath(relativePath);
  if (!normalized.startsWith('docs/development/')) {
    return [];
  }

  if (normalized.startsWith('docs/development/changes/')) {
    return [];
  }

  const fileName = path.basename(normalized).toLowerCase();
  const fileNameLooksLikeOperationDoc =
    /(^|[-_])(board|matrix|decisions)(\.md)$/.test(fileName) || /^current-.*\.md$/.test(fileName);
  const contentLooksLikeOperationDoc =
    /运行态文档|运行态执行板|验证矩阵|决策记录|当前状态|工作包|阻塞项|完成标准|验证方式/.test(
      content
    ) || /^- \[[ x-]\]/m.test(content);
  const looksLikeOperationDoc =
    /^current-.*\.md$/.test(fileName) ||
    /运行态文档|运行态执行板|验证矩阵|决策记录/.test(content) ||
    (fileNameLooksLikeOperationDoc && contentLooksLikeOperationDoc);

  if (!looksLikeOperationDoc) {
    return [];
  }

  return [
    buildIssue(
      'operation-doc-location',
      relativePath,
      '运行态执行板、验证矩阵、决策记录应放在 docs/operations/'
    ),
  ];
}

function checkCloseoutTargetTypes(relativePath, content) {
  const normalized = normalizePath(relativePath);
  if (normalized !== 'harness/process/README.md') {
    return [];
  }

  const required = ['single-task', 'staged/ongoing', 'continuation', 'explicit-closeout'];
  const missing = required.filter(item => !content.includes(item));
  if (missing.length === 0) {
    return [];
  }

  return [
    buildIssue(
      'closeout-target-types',
      relativePath,
      `README 缺少 final closeout 目标类型: ${missing.join('、')}`
    ),
  ];
}

function checkDeliveryContinuationCloseout(relativePath, content) {
  const normalized = normalizePath(relativePath);
  if (normalized !== 'harness/process/gates/delivery-gate.md') {
    return [];
  }

  const missing = [];
  if (
    !/continuation/.test(content) ||
    !/继续\s*\/\s*开始\s*\/\s*接着做\s*\/\s*按计划执行/.test(content)
  ) {
    missing.push('缺少 continuation 继承规则');
  }
  if (!/执行板|board/i.test(content) || !/checklist/.test(content)) {
    missing.push('缺少执行板/checklist 收口确认');
  }
  if (!/工作包完成当最终完成|工作包完成当作最终完成|仅完成一个工作包/.test(content)) {
    missing.push('缺少禁止单工作包误收口规则');
  }

  if (missing.length === 0) {
    return [];
  }

  return [
    buildIssue(
      'delivery-continuation-closeout',
      relativePath,
      `Delivery gate 缺少 continuation 收口约束: ${missing.join('、')}`
    ),
  ];
}

function checkFile(filePath, baseDir) {
  const relativePath = normalizePath(path.relative(baseDir, filePath));
  const content = fs.readFileSync(filePath, 'utf8');

  return [
    ...checkFinalCloseoutEvidence(relativePath, content),
    ...checkInProgressFinalCloseout(relativePath, content),
    ...checkFinalCloseoutNextStep(relativePath, content),
    ...checkFinalCloseoutActionableRisk(relativePath, content),
    ...checkFinalCloseoutRiskBoilerplate(relativePath, content),
    ...checkFinalCloseoutNextStepConflict(relativePath, content),
    ...checkGateOutputOneLine(relativePath, content),
    ...checkLongRunningPlan(relativePath, content),
    ...checkOperationDocLocation(relativePath, content),
    ...checkCloseoutTargetTypes(relativePath, content),
    ...checkDeliveryContinuationCloseout(relativePath, content),
  ];
}

function printUsage() {
  console.log('用法: node harness/process/automation/check-process.js <file-or-dir> [...]');
  console.log('用法: node harness/process/automation/check-process.js --changed');
  console.log('用法: node harness/process/automation/check-process.js --staged');
  console.log('选项: --max-issues <n> 限制输出的问题数量，默认 5');
  console.log('选项: --summary 只输出按规则聚合的数量');
  console.log(
    '示例: node harness/process/automation/check-process.js AGENTS.md harness/process docs'
  );
}

function parseMaxIssues(argv) {
  const index = argv.indexOf('--max-issues');
  if (index === -1) {
    return 5;
  }

  const value = Number.parseInt(argv[index + 1], 10);
  return Number.isFinite(value) && value > 0 ? value : 5;
}

function parseReportPath(argv) {
  const index = argv.indexOf('--report');
  if (index === -1) {
    return null;
  }

  return argv[index + 1] || null;
}

function hasSummary(argv) {
  return argv.includes('--summary');
}

function collectGitChangedFiles(baseDir, mode) {
  const args = ['diff', '--name-only', '--diff-filter=ACMR'];
  if (mode === 'staged') {
    args.splice(1, 0, '--cached');
  }

  const result = spawnSync('git', args, { cwd: baseDir, encoding: 'utf8' });
  if (result.status !== 0) {
    return [];
  }

  const trackedFiles = result.stdout
    .split(/\r?\n/)
    .map(file => file.trim())
    .filter(file => isMarkdownFile(file));

  if (mode === 'staged') {
    return trackedFiles;
  }

  const untrackedResult = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: baseDir,
    encoding: 'utf8',
  });
  if (untrackedResult.status !== 0) {
    return trackedFiles;
  }

  const untrackedFiles = untrackedResult.stdout
    .split(/\r?\n/)
    .map(file => file.trim())
    .filter(file => isMarkdownFile(file));

  return [...new Set([...trackedFiles, ...untrackedFiles])];
}

function parseTargets(argv) {
  const targets = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--max-issues') {
      index += 1;
      continue;
    }

    if (value === '--report') {
      index += 1;
      continue;
    }

    if (value === '--summary') {
      continue;
    }

    if (value === '--changed' || value === '--staged') {
      continue;
    }

    if (!value.startsWith('--')) {
      targets.push(value);
    }
  }

  return targets;
}

function writeReport(reportPath, payload) {
  if (!reportPath) {
    return;
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`详细报告: ${reportPath}`);
}

function printIssues(issues, maxIssues) {
  const visibleIssues = issues.slice(0, maxIssues);
  for (const issue of visibleIssues) {
    console.log(`${issue.file}`);
    console.log(`  rule: ${issue.rule}`);
    console.log(`  message: ${issue.message}\n`);
  }

  const hiddenCount = issues.length - visibleIssues.length;
  if (hiddenCount > 0) {
    console.log(`另有 ${hiddenCount} 个问题未显示；可用 --max-issues 调整输出数量。`);
  }
}

function printSummary(issues) {
  const counts = new Map();
  for (const issue of issues) {
    counts.set(issue.rule, (counts.get(issue.rule) || 0) + 1);
  }

  for (const [rule, count] of counts.entries()) {
    console.log(`${rule}: ${count}`);
  }
}

function run(argv, options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const parsedTargets = parseTargets(argv);
  let files;
  if (parsedTargets.length > 0) {
    files = parsedTargets.flatMap(target => collectMarkdownFiles(path.resolve(baseDir, target)));
  } else if (argv.includes('--staged')) {
    files = collectGitChangedFiles(baseDir, 'staged').map(file => path.resolve(baseDir, file));
  } else if (argv.includes('--changed')) {
    files = collectGitChangedFiles(baseDir, 'changed').map(file => path.resolve(baseDir, file));
  } else {
    files = ['AGENTS.md', 'harness/process', 'docs'].flatMap(target =>
      collectMarkdownFiles(path.resolve(baseDir, target))
    );
  }
  const issues = files.flatMap(file => checkFile(file, baseDir));

  return { files, issues };
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const { files, issues } = run(process.argv.slice(2));
  const maxIssues = parseMaxIssues(process.argv.slice(2));
  const summary = hasSummary(process.argv.slice(2));
  const reportPath = parseReportPath(process.argv.slice(2));

  if (issues.length === 0) {
    console.log(`未发现流程检查问题（扫描 ${files.length} 个 Markdown 文件）`);
    process.exit(0);
  }

  console.log(`发现 ${issues.length} 个流程检查问题:\n`);
  if (summary) {
    printSummary(issues);
  } else {
    printIssues(issues, maxIssues);
  }
  writeReport(reportPath, { filesScanned: files.length, issues });

  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  run,
  checkFile,
  collectMarkdownFiles,
  collectGitChangedFiles,
  parseMaxIssues,
  parseReportPath,
  hasSummary,
};
