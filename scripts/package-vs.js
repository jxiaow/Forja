/**
 * Package the VSCode extension into dist/vs/.
 *
 * Generates dist/vs/ containing:
 *   - compilot-x.x.x.vsix
 *   - README.md (VSCode extension documentation)
 *
 * Note: vsce always reads root README.md for the extension page,
 * so we temporarily swap it with the VS-specific README during packaging.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distVs = path.join(root, 'dist', 'vs');
const rootReadme = path.join(root, 'README.md');
const vsReadme = path.join(root, 'docs', 'README-vscode.md');
const backupReadme = path.join(root, 'README.md.bak');

// Clean previous build
if (fs.existsSync(distVs)) {
    fs.rmSync(distVs, { recursive: true });
}
fs.mkdirSync(distVs, { recursive: true });

// Swap README: use VS-specific README for vsce packaging
let swapped = false;
try {
    if (fs.existsSync(vsReadme)) {
        fs.copyFileSync(rootReadme, backupReadme);
        fs.copyFileSync(vsReadme, rootReadme);
        swapped = true;
    }

    // Build VSIX into dist/vs/
    execSync(`npx vsce package --allow-missing-repository -o dist/vs/`, { cwd: root, stdio: 'inherit' });
} finally {
    // Restore original README
    if (swapped && fs.existsSync(backupReadme)) {
        fs.copyFileSync(backupReadme, rootReadme);
        fs.unlinkSync(backupReadme);
    }
}

// Copy VSCode README into dist/vs/ for reference
if (fs.existsSync(vsReadme)) {
    fs.copyFileSync(vsReadme, path.join(distVs, 'README.md'));
    console.log('Copied: dist/vs/README.md');
}

console.log(`\nVSCode extension package complete: dist/vs/`);
