'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'apps', 'frame3d', 'src', 'wasm');
const executable = process.platform === 'win32' ? 'wasm-pack.exe' : 'wasm-pack';

execFileSync(executable, [
  'build',
  path.join(root, 'crates', 'frame3d-solver'),
  '--target', 'web',
  '--release',
  '--out-dir', output
], { cwd: root, stdio: 'inherit' });

fs.rmSync(path.join(output, '.gitignore'), { force: true });
console.log('Frame3D Rust/WebAssembly package generated.');
