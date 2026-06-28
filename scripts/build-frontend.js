const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const apiBase = process.env.BEAM_API_BASE_URL || '';

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest, transform = (text) => text) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const text = fs.readFileSync(src, 'utf8');
  fs.writeFileSync(dest, transform(text));
}

function minify(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

cleanDir(dist);
copyFile(path.join(root, 'index.html'), path.join(dist, 'index.html'), (text) => (
  minify(text).replace('window.BEAM_API_BASE_URL = window.BEAM_API_BASE_URL || "";', `window.BEAM_API_BASE_URL = window.BEAM_API_BASE_URL || ${JSON.stringify(apiBase)};`)
));
copyFile(path.join(root, 'public', 'secure-app.js'), path.join(dist, 'public', 'secure-app.js'), minify);

if (fs.existsSync(path.join(root, 'public', 'styles.css'))) {
  copyFile(path.join(root, 'public', 'styles.css'), path.join(dist, 'public', 'styles.css'), minify);
}

execFileSync(process.execPath, [path.join(root, 'scripts', 'check-public-bundle.js')], { stdio: 'inherit' });
console.log(`Frontend build complete: ${path.relative(root, dist)}`);
