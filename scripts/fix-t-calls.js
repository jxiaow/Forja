const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'cli', 'commands');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

let totalReplacements = 0;

for (const file of files) {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    const original = content;
    
    // More precise regex: only match T('key', locale) where key is alphanumeric/underscore
    // Use a function to ensure we only replace the exact pattern
    content = content.replace(/T\('([a-zA-Z_][a-zA-Z0-9_]*)',\s*locale\)/g, (match, key) => {
        return `T('${key}')`;
    });
    
    if (content !== original) {
        const count = (original.match(/T\('[a-zA-Z_][a-zA-Z0-9_]*',\s*locale\)/g) || []).length;
        totalReplacements += count;
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`${file}: ${count} replacements`);
    }
}

console.log(`\nTotal: ${totalReplacements} replacements in ${files.length} files`);
