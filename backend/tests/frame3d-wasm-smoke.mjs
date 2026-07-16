import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import init, { solve_linear_static_json } from '../../apps/frame3d/src/wasm/frame3d_solver.js';

const wasm = await readFile(new URL('../../apps/frame3d/src/wasm/frame3d_solver_bg.wasm', import.meta.url));
await init({ module_or_path: wasm });

const E = 200000;
const G = 80000;
const L = 2000;
const A = 10000;
const IY = 8e7;
const IZ = 5e7;
const J = 2e7;
const fixed = () => ({ ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
const free = () => ({ ux: false, uy: false, uz: false, rx: false, ry: false, rz: false });

function baseModel(load) {
  return {
    schemaVersion: '1.0.0',
    metadata: { projectName: 'WASM verification', modelName: 'Cantilever', engineer: '' },
    displayUnits: { force: 'N', length: 'mm', stress: 'N/mm²', moment: 'N·mm' },
    nodes: [
      { id: 'N1', x: 0, y: 0, z: 0, restraints: fixed() },
      { id: 'N2', x: L, y: 0, z: 0, restraints: free() }
    ],
    members: [{ id: 'M1', startNodeId: 'N1', endNodeId: 'N2', materialId: 'MAT', sectionId: 'SEC', rollAngleRad: 0 }],
    materials: [{ id: 'MAT', name: 'Steel', elasticModulus: E, poissonRatio: 0.25, shearModulus: G }],
    sections: [{ id: 'SEC', designation: 'Benchmark', area: A, iy: IY, iz: IZ, torsionConstant: J, sourceRevision: 'Analytical' }],
    loadCases: [{ id: 'LC1', name: 'Test', category: 'Other' }],
    combinations: [{ id: 'COMB1', name: '1.5 × LC1', factors: { LC1: 1.5 } }],
    nodalLoads: [{ id: 'P1', nodeId: 'N2', loadCaseId: 'LC1', fx: load[0], fy: load[1], fz: load[2], mx: load[3], my: load[4], mz: load[5] }],
    analysisSettings: { solver: 'linearStatic', selection: { type: 'loadCase', id: 'LC1' } }
  };
}

function solve(model, selection = model.analysisSettings.selection) {
  return JSON.parse(solve_linear_static_json(JSON.stringify({ model, selection })));
}

function compare(name, actual, expected, tolerance = 0.001) {
  const absoluteError = Math.abs(actual - expected);
  const relativeError = absoluteError / Math.max(Math.abs(expected), 1e-12);
  assert.ok(absoluteError <= 1e-9 || relativeError <= tolerance, `${name}: ${actual} differs from ${expected}`);
  return { name, expected, actual, relativeError };
}

const comparisons = [];
let result = solve(baseModel([100000, 0, 0, 0, 0, 0]));
assert.equal(result.status, 'ok');
comparisons.push(compare('Axial displacement PL/EA', result.nodes[1].translations[0], 100000 * L / (E * A)));

result = solve(baseModel([0, 0, -10000, 0, 0, 0]));
assert.equal(result.status, 'ok');
comparisons.push(compare('Cantilever tip deflection PL³/3EI', Math.abs(result.nodes[1].translations[2]), 10000 * L ** 3 / (3 * E * IZ)));
comparisons.push(compare('Cantilever tip rotation PL²/2EI', Math.abs(result.nodes[1].rotations[1]), 10000 * L ** 2 / (2 * E * IZ)));
comparisons.push(compare('Support moment PL', Math.abs(result.reactions[0].moments[1]), 10000 * L));
assert.ok(result.equilibrium.normalisedResidual <= 1e-8);

result = solve(baseModel([0, 0, 0, 0, 5e6, 0]));
assert.equal(result.status, 'ok');
comparisons.push(compare('Cantilever tip moment rotation ML/EI', Math.abs(result.nodes[1].rotations[1]), 5e6 * L / (E * IZ)));

result = solve(baseModel([0, 0, 0, 5e6, 0, 0]));
assert.equal(result.status, 'ok');
comparisons.push(compare('Cantilever torsion TL/GJ', result.nodes[1].rotations[0], 5e6 * L / (G * J)));

const combinationResult = solve(baseModel([100000, 0, 0, 0, 0, 0]), { type: 'combination', id: 'COMB1' });
assert.equal(combinationResult.status, 'ok');
comparisons.push(compare('Load combination factor', combinationResult.nodes[1].translations[0], 1.5 * 100000 * L / (E * A)));

const unstable = baseModel([0, 0, -10000, 0, 0, 0]);
unstable.nodes.forEach((node) => { node.restraints = free(); });
const unstableResult = solve(unstable);
assert.equal(unstableResult.status, 'error');
assert.ok([unstableResult.message, ...unstableResult.errors].some((message) => message.includes('Rigid-body instability')));

console.table(comparisons.map(({ name, expected, actual, relativeError }) => ({
  benchmark: name,
  expected,
  actual,
  'relative error': relativeError
})));
console.log('frame3d wasm verification ok', {
  analyticalComparisons: comparisons.length,
  failed: 0,
  equilibriumLimit: 1e-8,
  instabilityDiagnostic: true
});
