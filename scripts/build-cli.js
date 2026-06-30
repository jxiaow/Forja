/**
 * Build script for the standalone forja npm package.
 *
 * Generates dist/<version>/cli/ containing:
 *   - forja-cli-x.x.x.tgz (npm package)
 *   - README.md (CLI documentation)
 *   - skills/forja/SKILL.md + README.md (AI skill files)
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcOut = path.join(root, 'out');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

// Channel: --channel dev|stable (default: stable)
const channelIdx = process.argv.indexOf('--channel');
const channel = channelIdx >= 0 && process.argv[channelIdx + 1] ? process.argv[channelIdx + 1] : 'stable';
const versionSuffix = channel === 'stable' ? '' : `-${channel}`;
const displayVersion = `${version}${versionSuffix}`;

const distCli = path.join(root, 'dist', `forja-${version}`, 'cli');
const tmpBuild = path.join(root, 'dist', '_cli-build');

// Directories to copy (relative to out/)
const dirs = [
    'cli',
    'cli/commands',
    'qt/cli',
    'qt/shared',
    'qt/env',
    'qt/platform/win',
    'qt/platform/linux',
    'sdk/cli',
    'sdk/shared',
    'remote/cli',
    'remote/core'
];

// Individual files from sync/ needed by CLI (only pure Node files)
const syncFiles = [
    'sync/cli.js'
];

// Individual files needed from core/
const coreFiles = [
    'core/loggerBase.js',
    'core/settingsIO.js',
    'core/types.js',
    'core/syncState.js',
    'core/serverStore.js',
    'core/ssh.js',
    'core/sshTransport.js',
    'core/gitChangedFiles.js',
    'core/gitRepoResolver.js',
    'core/syncFileSelection.js',
    'core/sdkProjectScanner.js'
];

// Individual files needed from qt/platform/ (exclude builder.js, which depends on vscode)
const platformFiles = [
    'qt/platform/platformConfig.js',
    'qt/platform/requirements.js',
    'qt/platform/shellPlan.js'
];

// Version file at root of out/
const rootFiles = ['version.js'];

// Individual files needed from sdk/ (non-vscode ones)
const sdkFiles = ['sdk/constants.js'];

// Individual files needed from qt/build/ (non-vscode ones)
const qtBuildFiles = ['qt/build/designer.js'];

function copyDir(src, dst) {
    if (!fs.existsSync(src)) { return; }
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.json'))) {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}

function copyDirRecursive(src, dst) {
    if (!fs.existsSync(src)) { return; }
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const dstPath = path.join(dst, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, dstPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(srcPath, dstPath);
        }
    }
}

// Clean previous builds
if (fs.existsSync(distCli)) {
    fs.rmSync(distCli, { recursive: true });
}
if (fs.existsSync(tmpBuild)) {
    fs.rmSync(tmpBuild, { recursive: true });
}

// Create output directory
fs.mkdirSync(distCli, { recursive: true });

// --- Build npm package in temp directory ---

// Copy directories
for (const dir of dirs) {
    copyDir(path.join(srcOut, dir), path.join(tmpBuild, dir));
}

// Copy individual core files
for (const file of coreFiles) {
    const srcFile = path.join(srcOut, file);
    const dstFile = path.join(tmpBuild, file);
    if (fs.existsSync(srcFile)) {
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
    }
}

// Copy root-level files (version.js etc.)
for (const file of rootFiles) {
    const srcFile = path.join(srcOut, file);
    const dstFile = path.join(tmpBuild, file);
    if (fs.existsSync(srcFile)) {
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
    }
}

// Patch version.js with channel suffix for dev builds
if (versionSuffix && fs.existsSync(path.join(tmpBuild, 'version.js'))) {
    const vFile = path.join(tmpBuild, 'version.js');
    let vContent = fs.readFileSync(vFile, 'utf8');
    vContent = vContent.replace(
        /VERSION\s*=\s*["']([^"']+)["']/,
        `VERSION = "$1${versionSuffix}"`
    );
    fs.writeFileSync(vFile, vContent, 'utf8');
}

// Copy individual sync files (non-vscode only)
for (const file of syncFiles) {
    const srcFile = path.join(srcOut, file);
    const dstFile = path.join(tmpBuild, file);
    if (fs.existsSync(srcFile)) {
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
    }
}

// Copy individual platform files (non-vscode only)
for (const file of platformFiles) {
    const srcFile = path.join(srcOut, file);
    const dstFile = path.join(tmpBuild, file);
    if (fs.existsSync(srcFile)) {
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
    }
}

// Copy individual sdk files (non-vscode only)
for (const file of sdkFiles) {
    const srcFile = path.join(srcOut, file);
    const dstFile = path.join(tmpBuild, file);
    if (fs.existsSync(srcFile)) {
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
    }
}

// Copy individual qt/build files (non-vscode only)
for (const file of qtBuildFiles) {
    const srcFile = path.join(srcOut, file);
    const dstFile = path.join(tmpBuild, file);
    if (fs.existsSync(srcFile)) {
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
    }
}

// Ensure shebang on CLI entry point
const entryFile = path.join(tmpBuild, 'cli', 'index.js');
if (fs.existsSync(entryFile)) {
    const content = fs.readFileSync(entryFile, 'utf8');
    if (!content.startsWith('#!')) {
        fs.writeFileSync(entryFile, '#!/usr/bin/env node\n' + content, 'utf8');
    }
}

// Copy CLI README into npm package
const cliReadme = path.join(root, 'docs', 'README-cli.md');
if (fs.existsSync(cliReadme)) {
    fs.copyFileSync(cliReadme, path.join(tmpBuild, 'README.md'));
}

// Generate package.json for npm package
const mainPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const cliPkg = {
    name: 'forja',
    version: displayVersion,
    description: 'CLI for C++ project builds — Qt (qmake) and SDK (.sln/Makefile)',
    license: 'MIT',
    bin: {
        forja: './cli/index.js'
    },
    files: [
        'cli/**',
        'qt/**',
        'sdk/**',
        'sync/**',
        'remote/**',
        'core/**',
        'version.js'
    ],
    engines: {
        node: '>=18.0.0'
    },
    keywords: ['qt', 'qmake', 'sdk', 'cpp', 'build', 'forja']
};
fs.writeFileSync(path.join(tmpBuild, 'package.json'), JSON.stringify(cliPkg, null, 2) + '\n');

// Pack as tar.gz
const { execSync } = require('child_process');
execSync('npm pack', { cwd: tmpBuild, stdio: 'inherit' });

// Move .tgz to dist/<version>/cli/
const tgzFiles = fs.readdirSync(tmpBuild).filter(f => f.endsWith('.tgz'));
for (const tgz of tgzFiles) {
    const src = path.join(tmpBuild, tgz);
    const dstName = `forja-cli-${displayVersion}.tgz`;
    const dst = path.join(distCli, dstName);
    fs.renameSync(src, dst);
    console.log(`Packed: dist/forja-${version}/cli/${dstName}`);
}

// Remove temp build directory
fs.rmSync(tmpBuild, { recursive: true });

// --- Copy additional files into dist/cli/ ---

// Copy CLI README
const cliReadmeFinal = path.join(root, 'docs', 'README-cli.md');
if (fs.existsSync(cliReadmeFinal)) {
    fs.copyFileSync(cliReadmeFinal, path.join(distCli, 'README.md'));
    console.log('Copied: dist/forja-' + version + '/cli/README.md');
}

// Copy skills directory
const skillsSrc = path.join(root, 'skills', 'forja');
const skillsDst = path.join(distCli, 'skills', 'forja');
if (fs.existsSync(skillsSrc)) {
    copyDirRecursive(skillsSrc, skillsDst);
    console.log('Copied: dist/forja-' + version + '/cli/skills/forja/');
}

console.log(`\nCLI package complete (${channel}): dist/forja-${version}/cli/`);
