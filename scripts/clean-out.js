const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'out');

fs.rmSync(outDir, { recursive: true, force: true });
