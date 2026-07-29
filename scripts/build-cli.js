/**
 * Build script for the standalone compilot-cli npm package.
 *
 * Generates dist/<version>/cli/ containing:
 *   - compilot-cli-x.x.x.tgz (npm package)
 *   - README.md (CLI documentation)
 *   - skills/compilot/SKILL.md + README.md (AI skill files)
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcOut = path.join(root, 'out');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const distCli = path.join(root, 'dist', `compilot-${version}`, 'cli');
const tmpBuild = path.join(root, 'dist', '_cli-build');

// Directories to copy (relative to out/)
const dirs = [
    'cli',
    'qt/cli',
    'qt/shared',
    'qt/env',
    'qt/platform',
    'qt/platform/win',
    'qt/platform/linux',
    'sdk/cli'
];

// Individual files from qt/sync/ needed by CLI (only non-vscode ones)
const syncFiles = [
    'qt/sync/resolver.js',
    'qt/sync/transport.js'
];

// Individual files needed from core/
const coreFiles = [
    'core/logger.js',
    'core/loggerBase.js',
    'core/settingsIO.js',
    'core/types.js',
    'core/syncState.js',
    'core/serverStore.js',
    'core/ssh.js',
    'core/gitChangedFiles.js',
    'core/gitRepoResolver.js'
];

// Version file at root of out/
const rootFiles = ['version.js'];

// Individual files needed from sdk/ (non-vscode ones)
const sdkFiles = ['sdk/constants.js'];

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

// Copy individual sync files (non-vscode only)
for (const file of syncFiles) {
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
    name: 'compilot-cli',
    version: mainPkg.version,
    description: 'CLI for C++ project builds — Qt (qmake) and SDK (.sln/Makefile)',
    license: 'MIT',
    bin: {
        compilot: './cli/index.js'
    },
    files: [
        'cli/**',
        'qt/**',
        'sdk/**',
        'core/**',
        'version.js'
    ],
    engines: {
        node: '>=18.0.0'
    },
    keywords: ['qt', 'qmake', 'sdk', 'cpp', 'build', 'compilot']
};
fs.writeFileSync(path.join(tmpBuild, 'package.json'), JSON.stringify(cliPkg, null, 2) + '\n');

// Pack as tar.gz
const { execSync } = require('child_process');
execSync('npm pack', { cwd: tmpBuild, stdio: 'inherit' });

// Move .tgz to dist/<version>/cli/
const tgzFiles = fs.readdirSync(tmpBuild).filter(f => f.endsWith('.tgz'));
for (const tgz of tgzFiles) {
    const src = path.join(tmpBuild, tgz);
    const dst = path.join(distCli, tgz);
    fs.renameSync(src, dst);
    console.log(`Packed: dist/compilot-${version}/cli/${tgz}`);
}

// Remove temp build directory
fs.rmSync(tmpBuild, { recursive: true });

// --- Copy additional files into dist/cli/ ---

// Copy CLI README
const cliReadmeFinal = path.join(root, 'docs', 'README-cli.md');
if (fs.existsSync(cliReadmeFinal)) {
    fs.copyFileSync(cliReadmeFinal, path.join(distCli, 'README.md'));
    console.log('Copied: dist/compilot-' + version + '/cli/README.md');
}

// Copy skills directory
const skillsSrc = path.join(root, 'skills', 'compilot');
const skillsDst = path.join(distCli, 'skills', 'compilot');
if (fs.existsSync(skillsSrc)) {
    copyDirRecursive(skillsSrc, skillsDst);
    console.log('Copied: dist/compilot-' + version + '/cli/skills/compilot/');
}

console.log(`\nCLI package complete: dist/compilot-${version}/cli/`);
