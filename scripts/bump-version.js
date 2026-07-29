/**
 * Auto-increment patch version in package.json and cli/package.json.
 * Usage: node scripts/bump-version.js
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = [
    path.join(root, 'package.json'),
    path.join(root, 'cli', 'package.json')
];

for (const file of files) {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const parts = pkg.version.split('.');
    parts[2] = String(Number(parts[2]) + 1);
    pkg.version = parts.join('.');
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    console.log(`${path.basename(path.dirname(file))}/${path.basename(file)} → ${pkg.version}`);
}
