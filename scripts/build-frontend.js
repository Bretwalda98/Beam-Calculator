const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveFrontendApiBases } = require('./frontend-api-config');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const { beamApiBase: apiBase, frameApiBase: viteApiBase } = resolveFrontendApiBases();
const buildEnv = {
  ...process.env,
  BEAM_API_BASE_URL: apiBase,
  VITE_API_BASE_URL: viteApiBase
};

function absoluteOrigin(value) {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`Static API base must be an absolute URL: ${value}`);
  }
}

function injectFrameApiOrigins(text) {
  const productionOrigin = 'https://beam-calculator-api.harrynixon98.workers.dev';
  const origins = [...new Set([
    productionOrigin,
    absoluteOrigin(apiBase),
    absoluteOrigin(viteApiBase)
  ].filter(Boolean))];
  return text.replace(
    `connect-src 'self' ${productionOrigin};`,
    `connect-src 'self' ${origins.join(' ')};`
  );
}

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
copyFile(path.join(root, 'index.html'), path.join(dist, 'index.html'), minify);
copyFile(path.join(root, 'beam', 'index.html'), path.join(dist, 'beam', 'index.html'), (text) => (
  minify(text).replace('window.BEAM_API_BASE_URL = window.BEAM_API_BASE_URL || "";', `window.BEAM_API_BASE_URL = window.BEAM_API_BASE_URL || ${JSON.stringify(apiBase)};`)
));
copyFile(path.join(root, 'public', 'secure-app.js'), path.join(dist, 'public', 'secure-app.js'), minify);

if (fs.existsSync(path.join(root, 'public', 'styles.css'))) {
  copyFile(path.join(root, 'public', 'styles.css'), path.join(dist, 'public', 'styles.css'), minify);
}

['ads.txt', 'robots.txt', 'sitemap.xml', '_redirects', '_headers'].forEach((filename) => {
  const source = path.join(root, filename);
  if (fs.existsSync(source)) copyFile(
    source,
    path.join(dist, filename),
    filename === '_headers' ? injectFrameApiOrigins : undefined
  );
});
copyFile(path.join(root, 'privacy', 'index.html'), path.join(dist, 'privacy', 'index.html'), minify);

[
  path.join(root, 'apps', 'frame3d-hub', 'vite.config.ts'),
  path.join(root, 'apps', 'frame3d', 'vite.config.ts'),
  path.join(root, 'apps', 'solid-fem', 'vite.config.ts')
].forEach((configPath) => {
  execFileSync(process.execPath, [
    path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build',
    '--config',
    configPath
  ], { cwd: root, stdio: 'inherit', env: buildEnv });
});
execFileSync(process.execPath, [path.join(root, 'scripts', 'check-public-bundle.js')], {
  stdio: 'inherit',
  env: buildEnv
});
console.log(`Frontend build complete: ${path.relative(root, dist)}`);
