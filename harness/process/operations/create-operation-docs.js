#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const cwdRoot = process.cwd();
const defaultTemplateDir = path.resolve(__dirname, '_template');
const defaultOperationsDir = path.resolve(cwdRoot, 'docs/operations');

function normalizeInitiative(rawValue) {
  return rawValue
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseArgs(argv) {
  const options = {
    initiative: null,
    operationsDir: defaultOperationsDir,
    templateDir: defaultTemplateDir,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dir') {
      options.operationsDir = path.resolve(cwdRoot, argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (value === '--template') {
      options.templateDir = path.resolve(cwdRoot, argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (value === '--help' || value === '-h') {
      options.help = true;
      continue;
    }
    if (!value.startsWith('--') && !options.initiative) {
      options.initiative = normalizeInitiative(value);
      continue;
    }
    throw new Error(`未知参数：${value}`);
  }

  if (!options.help && !options.initiative) {
    throw new Error('缺少 initiative 名称');
  }

  return options;
}

function printUsage() {
  console.log('用法: node harness/process/operations/create-operation-docs.js <initiative>');
  console.log('示例: node harness/process/operations/create-operation-docs.js repo-restructure');
  console.log('选项: --dir <docs-operations-dir> 指定运行态文档目录');
}

function requiredTemplateFiles() {
  return [
    'README.md',
    'current-initiative.md',
    'initiative-board.md',
    'initiative-matrix.md',
    'initiative-decisions.md',
  ];
}

function ensureTemplateFiles(templateDir) {
  const missingFiles = requiredTemplateFiles().filter(
    file => !fs.existsSync(path.join(templateDir, file))
  );
  if (missingFiles.length > 0) {
    throw new Error(`模板目录缺少文件: ${missingFiles.join(', ')}`);
  }
}

function replaceTokens(content, initiative) {
  return content
    .replace(/<initiative>/g, initiative)
    .replace(/initiative-board\.md/g, `${initiative}-board.md`)
    .replace(/initiative-matrix\.md/g, `${initiative}-matrix.md`)
    .replace(/initiative-decisions\.md/g, `${initiative}-decisions.md`)
    .replace(/current-initiative\.md/g, `current-${initiative}.md`)
    .replace(/\bINIT\b/g, initiative.toUpperCase().replace(/-/g, '_'));
}

function createOperationDocs(options) {
  ensureTemplateFiles(options.templateDir);

  const targetDir = path.join(options.operationsDir, options.initiative);
  if (fs.existsSync(targetDir)) {
    throw new Error(`目标目录已存在: ${path.relative(cwdRoot, targetDir)}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const templateFiles = [
    ['README.md', 'README.md'],
    ['current-initiative.md', `current-${options.initiative}.md`],
    ['initiative-board.md', `${options.initiative}-board.md`],
    ['initiative-matrix.md', `${options.initiative}-matrix.md`],
    ['initiative-decisions.md', `${options.initiative}-decisions.md`],
  ];

  for (const [sourceName, targetName] of templateFiles) {
    const sourcePath = path.join(options.templateDir, sourceName);
    const targetPath = path.join(targetDir, targetName);
    const sourceContent = fs.readFileSync(sourcePath, 'utf8');
    fs.writeFileSync(targetPath, replaceTokens(sourceContent, options.initiative), 'utf8');
  }

  return {
    targetDir,
    files: templateFiles.map(([, targetName]) => path.join(targetDir, targetName)),
  };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printUsage();
      return;
    }

    const result = createOperationDocs(options);
    console.log(`已创建运行态文档目录: ${path.relative(cwdRoot, result.targetDir)}`);
    for (const file of result.files) {
      console.log(`- ${path.relative(cwdRoot, file)}`);
    }
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
  normalizeInitiative,
  parseArgs,
  createOperationDocs,
  replaceTokens,
  requiredTemplateFiles,
};
