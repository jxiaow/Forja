const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src', 'qt', 'platform', 'win', 'desktopLauncher.cpp');
const output = path.join(root, 'src', 'qt', 'platform', 'win', 'forja-desktop-launcher.exe');
const manifestPath = path.join(root, 'src', 'qt', 'platform', 'win', 'desktopLauncher.manifest.json');

function sha256(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function commandAvailable(command) {
    const probe = spawnSync(command, ['--version'], { stdio: 'ignore', windowsHide: true });
    return !probe.error;
}

const requestedCompiler = process.env.CXX?.trim();
const compiler = requestedCompiler
    || ['g++', 'clang++'].find(commandAvailable);
if (!compiler) {
    throw new Error('No supported C++ compiler found. Set CXX to g++ or clang++.');
}

const tempOutput = `${output}.tmp.exe`;
const args = [
    source,
    '-std=c++17',
    '-municode',
    '-mwindows',
    '-O2',
    '-static',
    '-s',
    '-o',
    tempOutput
];
const built = spawnSync(compiler, args, { cwd: root, stdio: 'inherit', windowsHide: true });
if (built.error) { throw built.error; }
if (built.status !== 0) { process.exit(built.status || 1); }

fs.renameSync(tempOutput, output);
const manifest = {
    source: path.relative(root, source).replace(/\\/g, '/'),
    sourceSha256: sha256(source),
    binarySha256: sha256(output),
    compiler
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Built: ${path.relative(root, output)}`);
