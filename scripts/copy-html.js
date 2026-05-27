const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src', 'ui', 'configPanel', 'configPanel.html');
const dst = path.join(root, 'out', 'ui', 'configPanel', 'configPanel.html');

fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
