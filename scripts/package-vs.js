/**
 * Package the VSCode extension into dist/<version>/vs/.
 *
 * Generates dist/<version>/vs/ containing:
 *   - forja-x.x.x.vsix
 *   - README.md (VSCode extension documentation)
 *
 * Note: vsce always reads root README.md for the extension page,
 * so we temporarily swap it with the VS-specific README during packaging.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;

// Channel: auto-detect from version (.dev suffix → dev), or override with --channel
const channelIdx = process.argv.indexOf('--channel');
const channel = channelIdx >= 0 && process.argv[channelIdx + 1]
    ? process.argv[channelIdx + 1]
    : (version.endsWith('.dev') ? 'dev' : 'stable');

// Dev builds append date: VSIX uses 0.7.55-dev.202607031430 (vsce requires hyphen pre-release)
function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}
const dateSuffix = (channel === 'dev') ? `-dev.${dateStamp()}` : '';
const displayVersion = channel === 'dev'
    ? `${version.replace(/\.dev$/, '')}${dateSuffix}`
    : version;

const distVs = path.join(root, 'dist', `forja-${version}`, 'vs');
const rootReadme = path.join(root, 'README.md');
const vsReadme = path.join(root, 'docs', 'README-vscode.md');
const backupReadme = path.join(root, 'README.md.bak');

// Clean previous build for this version
if (fs.existsSync(distVs)) {
    fs.rmSync(distVs, { recursive: true });
}
fs.mkdirSync(distVs, { recursive: true });

// Swap README: use VS-specific README for vsce packaging
let swapped = false;
let patchedPkg = false;
try {
    if (fs.existsSync(vsReadme)) {
        fs.copyFileSync(rootReadme, backupReadme);
        fs.copyFileSync(vsReadme, rootReadme);
        swapped = true;
    }

    // Patch displayName and version for non-stable channels
    if (channel !== 'stable') {
        if (!pkg.displayName.includes(`(${channel.charAt(0).toUpperCase() + channel.slice(1)})`)) {
            pkg.displayName = `${pkg.displayName} (${channel.charAt(0).toUpperCase() + channel.slice(1)})`;
        }
        pkg.version = displayVersion;
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
        patchedPkg = true;
    }

    // Build VSIX into dist/<version>/vs/
    execSync(`npx vsce package --allow-missing-repository -o dist/forja-${version}/vs/forja-${displayVersion}.vsix`, { cwd: root, stdio: 'inherit' });
} finally {
    // Restore original README
    if (swapped && fs.existsSync(backupReadme)) {
        fs.copyFileSync(backupReadme, rootReadme);
        fs.unlinkSync(backupReadme);
    }
    // Restore original package.json
    if (patchedPkg) {
        pkg.displayName = pkg.displayName.replace(/ \(Dev\)$/, '');
        pkg.version = version;
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    }
}

// Copy VSCode README into dist/<version>/vs/ for reference
if (fs.existsSync(vsReadme)) {
    fs.copyFileSync(vsReadme, path.join(distVs, 'README.md'));
    console.log('Copied: dist/forja-' + version + '/vs/README.md');
}

console.log(`\nVSCode extension package complete (${channel}): dist/forja-${version}/vs/`);
