#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const cwdRoot = process.cwd();
const sourceRoot = path.resolve(__dirname);
const defaultTarget = path.resolve(cwdRoot, 'dist/agent-harness');

const includeEntries = [
  'AGENTS.template.md',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'automation',
  'docs',
  'examples',
  'gates',
  'operations',
  'project/README.md',
  'project/_template',
  'project/create-adapter.js',
  'project/create-adapter.test.js',
  'project/profiles',
  'rules',
  'templates',
];

const blockedSegments = new Set(['local']);

function shouldSkipRelativePath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const segments = normalized.split('/').filter(Boolean);
  return segments.includes('tests') || normalized.endsWith('.test.js');
}

function parseArgs(argv) {
  const options = {
    target: defaultTarget,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--target') {
      options.target = path.resolve(cwdRoot, argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (value === '--help' || value === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`未知参数：${value}`);
  }

  return options;
}

function printUsage() {
  console.log('用法: node harness/process/export-open-source.js --target <dir>');
  console.log('示例: node harness/process/export-open-source.js --target dist/agent-harness');
}

function ensureSafeRelativePath(relativePath) {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  if (segments.some(segment => blockedSegments.has(segment))) {
    throw new Error(`公开导出禁止包含项目本地适配层：${relativePath}`);
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDirectory(source, target, relativeBase) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    const relativePath = path.join(relativeBase, entry.name);
    if (shouldSkipRelativePath(relativePath)) {
      continue;
    }
    ensureSafeRelativePath(relativePath);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath, relativePath);
      continue;
    }
    if (entry.isFile()) {
      copyFile(sourcePath, targetPath);
    }
  }
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

function exportOpenSource(options) {
  if (fs.existsSync(options.target)) {
    throw new Error(`目标目录已存在，拒绝覆盖：${options.target}`);
  }

  for (const entry of includeEntries) {
    ensureSafeRelativePath(entry);
    const source = path.join(sourceRoot, entry);
    const target = path.join(options.target, entry);
    if (shouldSkipRelativePath(entry)) {
      continue;
    }
    if (!fs.existsSync(source)) {
      throw new Error(`导出源不存在：${entry}`);
    }

    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      copyDirectory(source, target, entry);
    } else if (stat.isFile()) {
      copyFile(source, target);
    }
  }

  return {
    target: options.target,
    files: walkFiles(options.target),
  };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printUsage();
      return;
    }
    const result = exportOpenSource(options);
    console.log(`open-source harness exported: ${path.relative(cwdRoot, result.target)}`);
    console.log(`files: ${result.files.length}`);
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  exportOpenSource,
  parseArgs,
  includeEntries,
  shouldSkipRelativePath,
};
