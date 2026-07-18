import assert from 'node:assert/strict';

import worker from '../../src/worker.mjs';

const health = await worker.fetch(new Request('https://beam-calculator.pages.dev/api/health'));
assert.equal(health.status, 200);
assert.equal((await health.json()).ok, true);

const sections = await worker.fetch(new Request('https://beam-calculator.pages.dev/api/frame3d/sections'));
assert.equal(sections.status, 200);
const sectionBody = await sections.json();
assert.equal(sectionBody.ok, true);
assert.ok(Array.isArray(sectionBody.sections));
assert.ok(sectionBody.sections.length > 0);
const available = sectionBody.sections.find((section) => section.available);
assert.ok(available?.snapshot?.area > 0);
assert.ok(available?.snapshot?.iy > 0);
assert.ok(available?.snapshot?.iz > 0);
assert.ok(available?.snapshot?.torsionConstant > 0);
console.log('worker route smoke ok', {
  preservedHealthRoute: true,
  frame3dSections: sectionBody.sections.length,
  availableSection: available.designation
});
