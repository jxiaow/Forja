/**
 * Build script for the standalone qt-pilot-cli npm package.
 *
 * Copies compiled JS files needed by CLI/MCP into cli/out/,
 * so `cd cli && npm publish` produces a clean package.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcOut = path.join(root, 'out');
const dest = path.join(root, 'cli', 'out');

// Directories to copy (relative to out/)
const dirs = [
    'cli',
    'shared',
    'mcp',
    'env',
    'platform',
    'platform/win',
    'platform/linux',
    'sync'
];

// Individual files needed from core/ (logger is used by envDetector, settingsIO by qtCore)
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

// Ensure shebang on entry points
const entries = ['cli/index.js', 'mcp/server.js'];
for (const entry of entries) {
    const filePath = path.join(dest, entry);
    if (!fs.existsSync(filePath)) { continue; }
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.startsWith('#!')) {
        fs.writeFileSync(filePath, '#!/usr/bin/env node\n' + content, 'utf8');
    }
}

console.log(`qt-pilot-cli build complete: ${dest}`);
console.log('To publish: cd cli && npm publish');
