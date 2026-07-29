#!/usr/bin/env node
/**
 * Bulk rename: sdk → cpp across the codebase.
 * Preserves Windows SDK references (detectSdkVersion, sdkRoot, windowsSdk*, NemoSDK).
 *
 * Usage: node scripts/rename-sdk-to-cpp.js
 */

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const SCRIPTS_DIR = path.join(__dirname);

// Patterns that must NOT be renamed (Windows SDK, third-party, etc.)
const SKIP_PATTERNS = [
  /detectSdkVersion/i,
  /sdkRoot/i,
  /windowsSdk/i,
  /NemoSDK/,
  /Windows Kits/,
  /WindowsSDK/,
  /winSdk/i,
];

function shouldSkipLine(line) {
  return SKIP_PATTERNS.some(p => p.test(line));
}

// Ordered replacements: longer/more-specific first to avoid partial matches
const REPLACEMENTS = [
  // PascalCase types
  ['CppModulePrefs', 'CppModulePrefs'],
  ['CppSettings', 'CppSettings'],
  ['CppProjectInfo', 'CppProjectInfo'],
  ['CppPlanOptions', 'CppPlanOptions'],
  ['CppScanOptions', 'CppScanOptions'],
  ['CppCliSettings', 'CppCliSettings'],
  ['CppBuilder', 'CppBuilder'],
  ['CppKey', 'CppKey'],
  // camelCase fields/variables/functions — specific multi-char patterns first
  ['cppModulePrefs', 'cppModulePrefs'],
  ['cppCandidates', 'cppCandidates'],
  ['cppProjectName', 'cppProjectName'],
  ['loadCppSettings', 'loadCppSettings'],
  ['saveCppSettings', 'saveCppSettings'],
  ['getCppSetting', 'getCppSetting'],
  ['setCppSetting', 'setCppSetting'],
  ['scanCppProjects', 'scanCppProjects'],
  ['buildCppEnvCurrent', 'buildCppEnvCurrent'],
  ['getCppDefaultArch', 'getCppDefaultArch'],
  ['getCppAvailableArch', 'getCppAvailableArch'],
  ['getCppPlatformAvailable', 'getCppPlatformAvailable'],
  ['getCppPlatformConfigHints', 'getCppPlatformConfigHints'],
  ['createCppPlan', 'createCppPlan'],
  ['cppSettingsFilePath', 'cppSettingsFilePath'],
  ['buildCppCommand', 'buildCppCommand'],
  ['resolveCppWorkspaceRoot', 'resolveCppWorkspaceRoot'],
  ['_buildCppSettings', '_buildCppSettings'],
  ['_saveCppToStore', '_saveCppToStore'],
  ['sanitizeCppPrefs', 'sanitizeCppPrefs'],
  ['sanitizeCpp', 'sanitizeCpp'],
  ['buildCppSection', 'buildCppSection'],
  ['buildCppEnvSection', 'buildCppEnvSection'],
  ['buildCppVsCandidateSelect', 'buildCppVsCandidateSelect'],
  ['_updateCppDisplay', '_updateCppDisplay'],
  ['cppProjectScanner', 'cppProjectScanner'],
  ['activateCppModuleIfNoQtProject', 'activateCppModuleIfNoQtProject'],
  ['activateCpp', 'activateCpp'],
  ['buildCpp', 'buildCpp'],
  ['rebuildCpp', 'rebuildCpp'],
  ['cleanCpp', 'cleanCpp'],
  ['selectCppProject', 'selectCppProject'],
  ['setCppState', 'setCppState'],
  ['onCppUpdate', 'onCppUpdate'],
  ['setCppProjectRoot', 'setCppProjectRoot'],
  ['generateCppProperties', 'generateCppProperties'],  // "CppCpp" → just "Cpp"
  ['runCppCli', 'runCppCli'],
  ['cppExtension', 'cppExtension'],
  ['cppBuilder', 'cppBuilder'],
  ['cppReady', 'cppReady'],
  ['_cppReadyResolve', '_cppReadyResolve'],
  ['cppWorkspaceRoot', 'cppWorkspaceRoot'],
  ['cppSettingsDebounceTimer', 'cppSettingsDebounceTimer'],
  ['updateCppStatusBar', 'updateCppStatusBar'],
  ['_resolvedCpp', '_resolvedCpp'],
  ['cppWorkroot', 'cppWorkroot'],
  ['cppWs', 'cppWs'],
  ['cppSettings', 'cppSettings'],
  ['oldCppParsed', 'oldCppParsed'],
  ['oldCpp', 'oldCpp'],
  ['newCpp', 'newCpp'],
  ['cppResult', 'cppResult'],
  ['cppCount', 'cppCount'],
  ['cppFiles', 'cppFiles'],
  ['cppFile', 'cppFile'],
  ['cppLogger', 'cppLogger'],
  ['_cppProjectName', '_cppProjectName'],
  ['_cppMode', '_cppMode'],
  ['_cppArch', '_cppArch'],
  ['_cppIsBuilding', '_cppIsBuilding'],
  ['_cppUpdateListeners', '_cppUpdateListeners'],
  // Translation key names
  ['stopCppUnsupported', 'stopCppUnsupported'],
  ['foundQtCppNotAutoSelecting', 'foundQtCppNotAutoSelecting'],
  ['cppNoQmakeRcc', 'cppNoQmakeRcc'],
  ['cppBuildFailed', 'cppBuildFailed'],
  ['cppRunUnsupported', 'cppRunUnsupported'],
  ['cppCustomUnsupported', 'cppCustomUnsupported'],
  ['cppCleanFailed', 'cppCleanFailed'],
  // Type literal
  ["'cpp'", "'cpp'"],
  // Remaining lowercase (catch-all for variables/imports)
  ['cppCandidates', 'cppCandidates'],  // already above but ensure
];

// Import path replacements (for '.../sdk/...' → '.../cpp/...')
const IMPORT_REPLACEMENTS = [
  [/from\s+['"]([^'"]*)\bsdk\//g, (match, prefix) => match.replace('sdk/', 'cpp/')],
  [/require\(\s*['"]([^'"]*)\bsdk\//g, (match, prefix) => match.replace('sdk/', 'cpp/')],
  [/import\(\s*['"]([^'"]*)\bsdk\//g, (match, prefix) => match.replace('sdk/', 'cpp/')],
];

function processContent(content, filePath) {
  const lines = content.split('\n');
  const result = [];

  for (const line of lines) {
    if (shouldSkipLine(line)) {
      result.push(line);
      continue;
    }

    let processed = line;

    // Apply import path replacements first
    for (const [pattern, replacer] of IMPORT_REPLACEMENTS) {
      processed = processed.replace(pattern, replacer);
    }

    // Apply identifier replacements
    for (const [from, to] of REPLACEMENTS) {
      // Use split/join for exact string replacement (no regex issues)
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
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walkDir(fullPath, files);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Main
console.log('=== SDK → CPP Rename Script ===\n');

// 1. Process all source files
const allFiles = walkDir(SRC_DIR);
// Also process scripts
const scriptFiles = walkDir(SCRIPTS_DIR).filter(f => f.endsWith('.js'));
const filesToProcess = [...allFiles, ...scriptFiles];

let changedCount = 0;
for (const file of filesToProcess) {
  const original = fs.readFileSync(file, 'utf8');
  const processed = processContent(original, file);
  if (processed !== original) {
    fs.writeFileSync(file, processed, 'utf8');
    const rel = path.relative(path.join(__dirname, '..'), file);
    console.log(`  Updated: ${rel}`);
    changedCount++;
  }
}

console.log(`\n${changedCount} files updated.\n`);

// 2. Rename files with "sdk" in their name
const fileRenames = [
  ['src/core/cppProjectScanner.ts', 'src/core/cppProjectScanner.ts'],
  ['src/sdk/modules/cppBuilder.ts', 'src/sdk/modules/cppBuilder.ts'],
  ['src/sdk/cppExtension.ts', 'src/sdk/cppExtension.ts'],
  ['src/test/sdkCli.test.ts', 'src/test/cppCli.test.ts'],
  ['src/test/sdkDoesNotStealActiveModuleSource.test.ts', 'src/test/cppDoesNotStealActiveModuleSource.test.ts'],
  ['src/test/cppProjectScannerSource.test.ts', 'src/test/cppProjectScannerSource.test.ts'],
  ['src/test/cppSettingsWatcherSource.test.ts', 'src/test/cppSettingsWatcherSource.test.ts'],
];

const rootDir = path.join(__dirname, '..');
console.log('Renaming files:');
for (const [from, to] of fileRenames) {
  const fromPath = path.join(rootDir, from);
  const toPath = path.join(rootDir, to);
  if (fs.existsSync(fromPath)) {
    fs.renameSync(fromPath, toPath);
    console.log(`  ${from} → ${to}`);
  }
}

// 3. Rename directory src/sdk/ → src/cpp/
const sdkDir = path.join(rootDir, 'src', 'cpp');
const cppDir = path.join(rootDir, 'src', 'cpp');
if (fs.existsSync(sdkDir) && !fs.existsSync(cppDir)) {
  fs.renameSync(sdkDir, cppDir);
  console.log(`\n  src/sdk/ → src/cpp/`);
}

console.log('\n=== Done! Run `npx tsc --noEmit` to verify. ===');
