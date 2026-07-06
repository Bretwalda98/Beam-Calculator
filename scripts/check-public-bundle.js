const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const publicRoots = [
  path.join(root, 'index.html'),
  path.join(root, 'public'),
  path.join(root, 'dist')
];

const forbidden = [
  'PROFILE_DB',
  'sections_database.js',
  'function solveBeam',
  'function solveBeamFE',
  'function buildSectionCheck',
  'function evaluateLTB',
  'function buildLatexReport',
  'function buildReportHTML',
  'function runCalc',
  'My,Rd = Wpl',
  'Eurocode resistance checks remain Free',
  'COLBEAM',
  'Colbeam',
  'colbeam'
];

function walk(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  return fs.readdirSync(target).flatMap((name) => walk(path.join(target, name)));
}

const files = publicRoots.flatMap(walk).filter((file) => /\.(html|js|css)$/i.test(file));
const failures = [];

files.forEach((file) => {
  const text = fs.readFileSync(file, 'utf8');
  forbidden.forEach((token) => {
    if (text.includes(token)) failures.push(`${path.relative(root, file)} contains forbidden public token: ${token}`);
  });
  if (/sourceMappingURL=/i.test(text)) failures.push(`${path.relative(root, file)} contains a source map reference.`);
});

const publicDb = path.join(root, 'public', 'sections_database.js');
if (fs.existsSync(publicDb)) failures.push('public/sections_database.js must not exist in the production static tree.');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Public bundle security check passed (${files.length} files scanned).`);
