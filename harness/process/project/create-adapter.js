#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const cwdRoot = process.cwd();
const defaultTemplateDir = path.resolve(__dirname, '_template');
const defaultTarget = path.resolve(__dirname, 'local');

function parseArgs(argv) {
  const options = {
    name: 'Local Project Adapter',
    target: defaultTarget,
    template: defaultTemplateDir,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--name') {
      options.name = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === '--target') {
      options.target = path.resolve(cwdRoot, argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (value === '--template') {
      options.template = path.resolve(cwdRoot, argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (value === '--help' || value === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`未知参数：${value}`);
  }

  if (!options.name || !options.name.trim()) {
    throw new Error('--name 不能为空');
  }

  return options;
}

function printUsage() {
  console.log(
    '用法: node harness/process/project/create-adapter.js --target <dir> --name <adapter-name>'
  );
  console.log(
    '示例: node harness/process/project/create-adapter.js --target harness/process/project/local --name "Local Project Adapter"'
  );
}

function assertCanCreate(templateDir, targetDir) {
  if (!fs.existsSync(templateDir)) {
    throw new Error(`模板目录不存在：${templateDir}`);
  }
  if (fs.existsSync(targetDir)) {
    throw new Error(`目标目录已存在，拒绝覆盖：${targetDir}`);
  }
}

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function replaceInFile(filePath, replacements) {
  const original = fs.readFileSync(filePath, 'utf8');
  let next = original;
  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
  }
  if (next !== original) {
    fs.writeFileSync(filePath, next, 'utf8');
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

function createAdapter(options) {
  assertCanCreate(options.template, options.target);
  copyDirectory(options.template, options.target);

  const replacements = [['Local Project Adapter', options.name.trim()]];
  for (const file of walkFiles(options.target)) {
    replaceInFile(file, replacements);
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
    const result = createAdapter(options);
    console.log(`adapter created: ${path.relative(cwdRoot, result.target)}`);
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
  parseArgs,
  createAdapter,
  walkFiles,
};
