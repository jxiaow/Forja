const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src', 'ui', 'configPanel', 'configPanel.html');
const dst = path.join(root, 'out', 'ui', 'configPanel', 'configPanel.html');

fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);

const launcherSrc = path.join(root, 'src', 'qt', 'platform', 'win', 'forja-desktop-launcher.exe');
const launcherDst = path.join(root, 'out', 'qt', 'platform', 'win', 'forja-desktop-launcher.exe');
const launcherSource = path.join(root, 'src', 'qt', 'platform', 'win', 'desktopLauncher.cpp');
const launcherManifest = path.join(root, 'src', 'qt', 'platform', 'win', 'desktopLauncher.manifest.json');
if (!fs.existsSync(launcherSrc) || !fs.existsSync(launcherManifest)) {
    throw new Error('Missing Windows desktop launcher or manifest; run npm run build:native:windows');
}
const manifest = JSON.parse(fs.readFileSync(launcherManifest, 'utf8'));
const sha256 = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
if (manifest.sourceSha256 !== sha256(launcherSource) || manifest.binarySha256 !== sha256(launcherSrc)) {
    throw new Error('Windows desktop launcher is stale; run npm run build:native:windows');
}
fs.mkdirSync(path.dirname(launcherDst), { recursive: true });
fs.copyFileSync(launcherSrc, launcherDst);
