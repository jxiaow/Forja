/**
 * Build script for the standalone compilot-cli npm package.
 *
 * Generates a complete npm package under dist/compilot-cli/,
 * ready for `cd dist/compilot-cli && npm publish`.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcOut = path.join(root, 'out');
const dest = path.join(root, 'dist', 'compilot-cli');

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
    'qt/sync/syncCli.js',
    'qt/sync/syncState.js',
    'qt/sync/resolver.js',
    'qt/sync/transport.js',
    'qt/sync/serverStore.js'
];

// Individual files needed from core/
const coreFiles = ['core/logger.js', 'core/settingsIO.js'];

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

// Clean previous build
if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true });
}

// Copy directories
for (const dir of dirs) {
    copyDir(path.join(srcOut, dir), path.join(dest, dir));
}

// Copy individual core files
for (const file of coreFiles) {
    const srcFile = path.join(srcOut, file);
    const dstFile = path.join(dest, file);
    if (fs.existsSync(srcFile)) {
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
    }
}

// Copy individual sync files (non-vscode only)
for (const file of syncFiles) {
    const srcFile = path.join(srcOut, file);
    const dstFile = path.join(dest, file);
    if (fs.existsSync(srcFile)) {
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
    }
}

// Ensure shebang on CLI entry point
const entryFile = path.join(dest, 'cli', 'index.js');
if (fs.existsSync(entryFile)) {
    const content = fs.readFileSync(entryFile, 'utf8');
    if (!content.startsWith('#!')) {
        fs.writeFileSync(entryFile, '#!/usr/bin/env node\n' + content, 'utf8');
    }
}

// Generate package.json
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
        'core/**'
    ],
    engines: {
        node: '>=18.0.0'
    },
    keywords: ['qt', 'qmake', 'sdk', 'cpp', 'build', 'compilot']
};
fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify(cliPkg, null, 2) + '\n');

console.log(`compilot-cli build complete: ${dest}`);
console.log('To publish: cd dist/compilot-cli && npm publish');

// Pack as tar.gz and clean up the directory
const { execSync } = require('child_process');
execSync('npm pack', { cwd: dest, stdio: 'inherit' });

// Move .tgz to dist/ root
const tgzFiles = fs.readdirSync(dest).filter(f => f.endsWith('.tgz'));
for (const tgz of tgzFiles) {
    const src = path.join(dest, tgz);
    const dst = path.join(root, 'dist', tgz);
    fs.renameSync(src, dst);
    console.log(`Packed: dist/${tgz}`);
}

// Remove the temporary directory
fs.rmSync(dest, { recursive: true });
console.log('Cleaned up dist/compilot-cli/');
