#!/usr/bin/env node
/**
 * Fix remaining SDK references in src/cpp/ and other files.
 * Second pass after the main rename script.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// Files to process (src/cpp/ and specific files)
const dirs = [
  path.join(ROOT, 'src', 'cpp'),
];

const SKIP_PATTERNS = [
  /detectSdkVersion/i, /sdkRoot/i, /windowsSdk/i, /NemoSDK/,
  /Windows Kits/, /WindowsSDK/, /winSdk/i,
];

// User-visible text replacements (Chinese + English)
const TEXT_REPLACEMENTS = [
  ['SDK 模块', 'C++ 模块'],
  ['SDK 项目', 'C++ 项目'],
  ['SDK 配置', 'C++ 配置'],
  ['SDK 构建', 'C++ 构建'],
  ['SDK 平台', 'C++ 平台'],
  ['SDK CLI', 'C++ CLI'],
  ['SDK build', 'C++ build'],
  ['SDK 状态', 'C++ 状态'],
  ['SDK 成功', 'C++ 成功'],
  ['SDK 失败', 'C++ 失败'],
  ['SDK 命令', 'C++ 命令'],
  ['SDK 环境', 'C++ 环境'],
  ['SDK 就绪', 'C++ 就绪'],
  ['SDK 未就绪', 'C++ 未就绪'],
  ['未选择 SDK', '未选择 C++'],
  ['尚未初始化', '尚未初始化'],
  // Interface/type names
  ['SdkCliOptions', 'CppCliOptions'],
  ['EffectiveSdkCliOptions', 'EffectiveCppCliOptions'],
  ['SdkDiagnostic', 'CppDiagnostic'],
  // Function names
  ['formatSdkInitText', 'formatCppInitText'],
  ['formatSdkProjectsText', 'formatCppProjectsText'],
  ['formatSdkFailureText', 'formatCppFailureText'],
  // Import aliases
  ['_loadSdk', '_loadCpp'],
  ['_saveSdk', '_saveCpp'],
  // Variable names
  ['const sdk ', 'const cpp '],
  ['const sdk=', 'const cpp='],
  ['...sdk,', '...cpp,'],
  ['sdk.vsInstall', 'cpp.vsInstall'],
  // Comments
  ['SDK 部分恢复', 'C++ 部分恢复'],
  ['SDK 部分', 'C++ 部分'],
  ['SDK 项目所在', 'C++ 项目所在'],
  ['SDK build plan', 'C++ build plan'],
  ['SDK project', 'C++ project'],
  ['SDK 项目信息', 'C++ 项目信息'],
  ['SDK 平台需求', 'C++ 平台需求'],
  ['SDK CLI 配置', 'C++ CLI 配置'],
  ['sdk 配置', 'cpp 配置'],
  ['SDK CLI entry', 'C++ CLI entry'],
  ['SDK CLI 环境', 'C++ CLI 环境'],
  ['Forja SDK:', 'Forja C++:'],
  ['Forja SDK CLI', 'Forja C++ CLI'],
];

function processContent(content) {
  const lines = content.split('\n');
  const result = [];
  for (const line of lines) {
    if (SKIP_PATTERNS.some(p => p.test(line))) {
      result.push(line);
      continue;
    }
    let processed = line;
    for (const [from, to] of TEXT_REPLACEMENTS) {
      while (processed.includes(from)) {
        processed = processed.replace(from, to);
      }
    }
    result.push(processed);
  }
  return result.join('\n');
}

function walkDir(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, files);
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

let changed = 0;
for (const dir of dirs) {
  for (const file of walkDir(dir)) {
    const orig = fs.readFileSync(file, 'utf8');
    const proc = processContent(orig);
    if (proc !== orig) {
      fs.writeFileSync(file, proc, 'utf8');
      console.log(`  ${path.relative(ROOT, file)}`);
      changed++;
    }
  }
}

// Also fix specific files outside src/cpp/
const extraFiles = [
  'src/ui/configPanel/messageHandler.ts',
  'src/ui/configPanel/pages/env.ts',
  'src/ui/configPanel/pages/project.ts',
  'src/extension.ts',
];

for (const rel of extraFiles) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const orig = fs.readFileSync(file, 'utf8');
  const proc = processContent(orig);
  if (proc !== orig) {
    fs.writeFileSync(file, proc, 'utf8');
    console.log(`  ${rel}`);
    changed++;
  }
}

console.log(`\n${changed} files updated.`);
