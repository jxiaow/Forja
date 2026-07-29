#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '../../../../..');
const defaultReportPath = '.tmp/harness-check-report.json';

function runNodeScript(scriptName, args = []) {
  const scriptPath =
    scriptName === 'check-entry.js'
      ? path.join('harness', 'process', 'project', 'local', 'automation', scriptName)
      : scriptName;
  const commandLabel = ['node', scriptPath, ...args].join(' ');
  console.log(`> ${commandLabel}`);

  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    encoding: 'utf8',
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result.status || 0;
}

function resolveEntryMode(argv) {
  return argv.includes('--staged') ? '--staged' : '--changed';
}

function resolveProcessMode(argv) {
  return argv.includes('--staged') ? '--staged' : '--changed';
}

function resolveMaxIssueArgs(argv) {
  const index = argv.indexOf('--max-issues');
  if (index === -1) {
    return [];
  }

  const value = argv[index + 1];
  return value ? ['--max-issues', value] : [];
}

function resolveSummaryArgs(argv) {
  return argv.includes('--summary') ? ['--summary'] : [];
}

function resolveReportArgs(argv) {
  const index = argv.indexOf('--report');
  if (index !== -1) {
    const value = argv[index + 1];
    return value ? ['--report', value] : [];
  }

  return ['--report', defaultReportPath];
}

function resolveExplicitTargets(argv) {
  const targets = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--max-issues' || value === '--report') {
      index += 1;
      continue;
    }

    if (value === '--summary' || value === '--changed' || value === '--staged') {
      continue;
    }

    if (!value.startsWith('--')) {
      targets.push(value);
    }
  }

  return targets;
}

function main() {
  const argv = process.argv.slice(2);
  const explicitTargets = argv.includes('--staged') ? [] : resolveExplicitTargets(argv);
  const processMode = resolveProcessMode(argv);
  const entryMode = resolveEntryMode(argv);
  const maxIssueArgs = resolveMaxIssueArgs(argv);
  const summaryArgs = resolveSummaryArgs(argv);
  const reportArgs = resolveReportArgs(argv);
  const processArgs =
    explicitTargets.length > 0
      ? [...explicitTargets, ...summaryArgs, ...maxIssueArgs, ...reportArgs]
      : [processMode, ...summaryArgs, ...maxIssueArgs, ...reportArgs];
  const entryArgs =
    explicitTargets.length > 0
      ? ['--files', ...explicitTargets, ...summaryArgs, ...maxIssueArgs, ...reportArgs]
      : [entryMode, ...summaryArgs, ...maxIssueArgs, ...reportArgs];
  const checks = [
    [path.join('harness', 'process', 'automation', 'check-process.js'), processArgs],
    ['check-entry.js', entryArgs],
  ];

  for (const [scriptName, args] of checks) {
    const status = runNodeScript(scriptName, args);
    if (status !== 0) {
      process.exit(status);
    }
  }

  console.log('harness checks passed');
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  resolveEntryMode,
  resolveProcessMode,
  resolveMaxIssueArgs,
  resolveSummaryArgs,
  resolveReportArgs,
  resolveExplicitTargets,
  runNodeScript,
};
