#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function buildIssue(rule, file, message) {
  return { rule, file, message };
}

function isSourceFile(relativePath) {
  return /^src\/.+\.ts$/.test(relativePath) && !relativePath.includes('/test/');
}

function isSharedFile(relativePath) {
  return /^src\/qt\/shared\/.+\.ts$/.test(relativePath) || /^src\/cli\/.+\.ts$/.test(relativePath);
}

function isEntryCheckCandidate(relativePath) {
  return isSourceFile(relativePath);
}

/**
 * Check that shared/ and cli/ files do not import vscode
 */
function checkSharedVscodeDependency(relativePath, content) {
  if (!isSharedFile(relativePath)) {
    return [];
  }

  if (/import\s+\*\s+as\s+vscode\s+from\s+['"]vscode['"]/.test(content)) {
    return [
      buildIssue(
        'shared-vscode-dependency',
        relativePath,
        'shared/ 和 cli/ 模块禁止依赖 vscode 命名空间'
      ),
    ];
  }

  if (/from\s+['"]vscode['"]/.test(content)) {
    return [
      buildIssue(
        'shared-vscode-dependency',
        relativePath,
        'shared/ 和 cli/ 模块禁止依赖 vscode 命名空间'
      ),
    ];
  }

  return [];
}

/**
 * Check that new commands in extension.ts have corresponding package.json entries
 * Note: Internal commands (not user-facing) may intentionally skip package.json declaration
 */
function checkCommandRegistration(relativePath, content, baseDir) {
  if (relativePath !== 'src/extension.ts') {
    return [];
  }

  const issues = [];
  const packageJsonPath = path.join(baseDir, 'package.json');
  const packageContent = readIfExists(packageJsonPath);

  if (!packageContent) {
    return [];
  }

  // Find registerCommand calls in the cmds array (user-facing commands)
  // Internal commands like showSyncTab, loadManualProject, runCustomCommand are intentionally not in package.json
  const commandRegex = /registerCommand\s*\(\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = commandRegex.exec(content)) !== null) {
    const commandId = match[1];
    // Skip known internal commands that don't need package.json declaration
    if (commandId.includes('showSyncTab') || commandId.includes('loadManualProject') || commandId.includes('runCustomCommand')) {
      continue;
    }
    if (!packageContent.includes(`"${commandId}"`)) {
      issues.push(
        buildIssue(
          'command-not-in-package',
          relativePath,
          `命令 ${commandId} 已注册但未在 package.json contributes.commands 中声明`
        )
      );
    }
  }

  return issues;
}

/**
 * Check that disposables are pushed to subscriptions
 */
function checkDisposableManagement(relativePath, content) {
  if (!isSourceFile(relativePath)) {
    return [];
  }

  // Only check files that create watchers or register commands
  const hasWatcher = /createFileSystemWatcher/.test(content);
  const hasRegister = /registerCommand/.test(content);

  if (!hasWatcher && !hasRegister) {
    return [];
  }

  // Check if context.subscriptions.push is used
  if (/context\.subscriptions\.push/.test(content)) {
    return [];
  }

  // If the file has registrations but no subscriptions push, flag it
  if (hasRegister && /function\s+activate/.test(content)) {
    return [
      buildIssue(
        'missing-disposable-push',
        relativePath,
        '注册了命令或监听器但未推入 context.subscriptions'
      ),
    ];
  }

  return [];
}

function checkFile(filePath, baseDir) {
  const relativePath = normalizePath(path.relative(baseDir, filePath));
  const content = readIfExists(filePath);

  return [
    ...checkSharedVscodeDependency(relativePath, content),
    ...checkCommandRegistration(relativePath, content, baseDir),
    ...checkDisposableManagement(relativePath, content),
  ];
}

function parseFiles(argv) {
  const filesIndex = argv.indexOf('--files');
  if (filesIndex === -1) {
    return [];
  }

  const files = [];
  for (let index = filesIndex + 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith('--')) {
      break;
    }
    files.push(value);
  }

  return files;
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
    .filter(Boolean);

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
    .filter(Boolean);

  return [...new Set([...trackedFiles, ...untrackedFiles])];
}

function resolveTargetFiles(argv, baseDir) {
  const explicitFiles = parseFiles(argv);
  if (explicitFiles.length > 0) {
    return explicitFiles;
  }

  if (argv.includes('--staged')) {
    return collectGitChangedFiles(baseDir, 'staged');
  }

  if (argv.includes('--changed')) {
    return collectGitChangedFiles(baseDir, 'changed');
  }

  return [];
}

function printUsage() {
  console.log(
    '用法: node harness/process/project/local/automation/check-entry.js --files <changed-file> [...]'
  );
  console.log('用法: node harness/process/project/local/automation/check-entry.js --changed');
  console.log('用法: node harness/process/project/local/automation/check-entry.js --staged');
  console.log('选项: --max-issues <n> 限制输出的问题数量，默认 5');
  console.log('选项: --summary 只输出按规则聚合的数量');
  console.log(
    '示例: node harness/process/project/local/automation/check-entry.js --files src/qt/shared/qtCore.ts'
  );
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

function writeReport(reportPath, payload) {
  if (!reportPath) {
    return;
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`详细报告: ${reportPath}`);
}

function run(argv, options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const relativeFiles = resolveTargetFiles(argv, baseDir);
  const files = relativeFiles
    .map(file => path.resolve(baseDir, file))
    .filter(file => fs.existsSync(file))
    .filter(file => isEntryCheckCandidate(normalizePath(path.relative(baseDir, file))));
  const issues = files.flatMap(file => checkFile(file, baseDir));

  return { files, issues };
}

function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const argv = process.argv.slice(2);
  const { files, issues } = run(argv);
  const maxIssues = parseMaxIssues(argv);
  const summary = hasSummary(argv);
  const reportPath = parseReportPath(argv);
  if (files.length === 0) {
    if (argv.includes('--changed') || argv.includes('--staged') || parseFiles(argv).length > 0) {
      console.log('未发现入口检查问题（没有可检查的变更文件）');
      process.exit(0);
    }

    printUsage();
    process.exit(1);
  }

  if (issues.length === 0) {
    console.log(`未发现入口检查问题（扫描 ${files.length} 个文件）`);
    process.exit(0);
  }

  console.log(`发现 ${issues.length} 个入口检查问题:\n`);
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
  collectGitChangedFiles,
  isEntryCheckCandidate,
  parseMaxIssues,
  parseReportPath,
  hasSummary,
};
