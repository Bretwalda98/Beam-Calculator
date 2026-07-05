const assert = require('assert');
const { calculateBeam } = require('../services/calculation-service');

function baseInput(direction = 'Y') {
  return {
    section: { family: 'IPE', name: 'IPE100' },
    material: { grade: 'S355' },
    units: 'kn',
    model: { span: 6, supportType: 'ss', includeSelfWeight: false },
    combination: {
      combination: 'en1990_610',
      psiQ1: 0.7,
      psiQ2: 0.7,
      customULSFactors: { G: 1.35, Q1: 1.5, Q2: 1.5 },
      customSLSFactors: { G: 1, Q1: 1, Q2: 0.7 },
      slsDeflectionBasis: 'total',
      slsIncludeSelfWeight: true
    },
    settings: {
      sectionClass: 2,
      gammaM0: 1,
      gammaM1: 1,
      deflectionLimit: 300,
      enableLTB: false
    },
    loads: {
      udls: [{ label: `${direction} UDL`, direction, x1: 0, x2: 6, G: 1, Q1: 0, Q2: 0 }],
      points: []
    },
    axial: { G: 0, Q1: 0, Q2: 0 }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function approxEqual(a, b, label) {
  assert.ok(Math.abs(a - b) <= Math.max(1e-8, Math.abs(b) * 1e-8), `${label}: expected ${a} to equal ${b}`);
}

const yInput = baseInput('Y');
const y = calculateBeam(yInput);
assert.ok(y.actions.axis.MyEd > 0, 'Y-direction UDL should produce major-axis MyEd.');
assert.strictEqual(y.actions.axis.MzEd, 0);
assert.ok(y.actions.axis.VyEd > 0, 'Y-direction UDL should produce major-axis shear action.');
assert.strictEqual(y.actions.axis.governingAxis, 'y');

const legacyInput = clone(yInput);
delete legacyInput.loads.udls[0].direction;
const legacy = calculateBeam(legacyInput);
approxEqual(legacy.actions.axis.MyEd, y.actions.axis.MyEd, 'Missing legacy direction should default to Y/major-axis action');
approxEqual(legacy.summary.maxMoment, y.summary.maxMoment, 'Missing legacy direction should preserve old max moment');

const zInput = baseInput('Z');
const z = calculateBeam(zInput);
assert.strictEqual(z.actions.axis.MyEd, 0);
assert.ok(z.actions.axis.MzEd > 0, 'Z-direction UDL should produce minor-axis MzEd when Iz exists.');
assert.ok(z.actions.axis.MzRd > 0, 'Z-direction UDL should produce MzRd when Wz exists.');
assert.ok(z.checks.minorAxis.available, 'Minor-axis check should be available for IPE100 z-axis bending.');
assert.strictEqual(z.actions.axis.governingAxis, 'z');
assert.ok(z.actions.axis.warnings.some((warning) => warning.includes('Avy')), 'Missing minor-axis shear area should be warned, not inferred.');

const mixedInput = baseInput('Y');
mixedInput.loads.udls.push({ label: 'Z UDL', direction: 'Z', x1: 0, x2: 6, G: 1, Q1: 0, Q2: 0 });
const mixed = calculateBeam(mixedInput);
assert.ok(mixed.actions.axis.MyEd > 0, 'Mixed Y/Z loads should retain MyEd.');
assert.ok(mixed.actions.axis.MzEd > 0, 'Mixed Y/Z loads should retain MzEd.');
assert.notStrictEqual(mixed.actions.axis.MyIR, mixed.actions.axis.MzIR, 'Mixed-axis checks should stay separate.');

const missingMinorInput = baseInput('Z');
missingMinorInput.section = { family: 'HEA', name: 'HE 200 A' };
const missingMinor = calculateBeam(missingMinorInput);
assert.strictEqual(missingMinor.checks.minorAxis.available, false);
assert.ok(missingMinor.checks.minorAxis.warnings.some((warning) => warning.includes('Wpl_z_mm3')), 'Missing z modulus should be reported.');
assert.strictEqual(missingMinor.actions.axis.MzRd, null);

const customY = baseInput('Y');
customY.combination.combination = 'custom_colbeam';
customY.combination.customULSFactors = { G: 2, Q1: 2, Q2: 2 };
const customYResult = calculateBeam(customY);
assert.ok(customYResult.actions.axis.MyEd > y.actions.axis.MyEd, 'Stage 4 custom ULS factors should still affect Y-direction actions.');

const customZ = baseInput('Z');
customZ.combination.combination = 'custom_colbeam';
customZ.combination.customULSFactors = { G: 2, Q1: 2, Q2: 2 };
const customZResult = calculateBeam(customZ);
assert.ok(customZResult.actions.axis.MzEd > z.actions.axis.MzEd, 'Stage 4 custom ULS factors should still affect Z-direction actions.');

console.log('colbeam stage5 load directions ok', {
  yMyEd: y.actions.axis.MyEd,
  zMzEd: z.actions.axis.MzEd,
  zMzRd: z.actions.axis.MzRd,
  mixedGoverningAxis: mixed.actions.axis.governingAxis,
  missingMinorWarning: missingMinor.checks.minorAxis.warnings[0]
});
