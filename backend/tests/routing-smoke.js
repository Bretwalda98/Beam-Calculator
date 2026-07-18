'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { server } = require('../../server');

async function run() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const expectations = [
      ['/', 200, 'Choose your analysis workspace'],
      ['/beam/', 200, 'Beam Calculator Studio'],
      ['/beam', 200, 'Beam Calculator Studio'],
      ['/frame3d/', 200, '3D Analysis | Beam Calculator Studio'],
      ['/frame3d', 200, '3D Analysis | Beam Calculator Studio'],
      ['/frame3d/frame/', 200, '3D Frame Analysis'],
      ['/frame3d/frame', 200, '3D Frame Analysis'],
      ['/frame3d/solid/', 200, 'Solid CAD/FEM'],
      ['/frame3d/solid', 200, 'Solid CAD/FEM'],
      ['/privacy/', 200, 'Privacy Policy'],
      ['/public/secure-app.js', 200, 'const API_BASE'],
      ['/api/health', 200, '"ok":true'],
      ['/api/frame3d/sections', 200, '"sections"']
    ];
    for (const [pathname, expectedStatus, expectedText] of expectations) {
      const response = await fetch(base + pathname);
      const body = await response.text();
      assert.strictEqual(response.status, expectedStatus, `${pathname} returned ${response.status}`);
      assert.ok(body.includes(expectedText), `${pathname} did not include expected content`);
    }
    const wasmFile = fs.readdirSync(path.join(__dirname, '..', '..', 'dist', 'frame3d', 'frame', 'assets')).find((name) => name.endsWith('.wasm'));
    assert.ok(wasmFile, 'Frame3D build should include a WebAssembly asset.');
    const wasmResponse = await fetch(`${base}/frame3d/frame/assets/${wasmFile}`);
    assert.strictEqual(wasmResponse.status, 200);
    assert.strictEqual(wasmResponse.headers.get('content-type'), 'application/wasm');
    assert.match(wasmResponse.headers.get('content-security-policy') || '', /script-src 'self' 'wasm-unsafe-eval'/);
    assert.match(wasmResponse.headers.get('content-security-policy') || '', /worker-src 'self'/);
    const beamResponse = await fetch(`${base}/beam/`);
    assert.doesNotMatch(beamResponse.headers.get('content-security-policy') || '', /wasm-unsafe-eval/);
    console.log('routing smoke ok', { routes: expectations.length, wasm: wasmFile });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
