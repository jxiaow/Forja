/**
 * Release script — bump version, commit, tag, push to both remotes.
 * Cross-platform replacement for inline shell chains.
 */
const { execSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(require('fs').readFileSync(path.join(root, 'package.json'), 'utf8'));

// 1. bump version
require('./bump-version');

// 2. re-read version after bump
const newPkg = JSON.parse(require('fs').readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = newPkg.version;

// 3. commit + tag
execSync('git add -A', { cwd: root, stdio: 'inherit' });
execSync(`git commit -m "chore: bump version to ${version}"`, { cwd: root, stdio: 'inherit' });
execSync(`git tag v${version}`, { cwd: root, stdio: 'inherit' });

// 4. push both remotes
execSync('git push origin master --follow-tags', { cwd: root, stdio: 'inherit' });
execSync('git push github master --follow-tags', { cwd: root, stdio: 'inherit' });

console.log(`\nReleased v${version} → Gitee + GitHub ✅`);
