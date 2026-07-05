const assert = require('assert');
const { calculateBeam } = require('../services/calculation-service');

function baseInput() {
  return {
    section: { family: 'HEA', name: 'HE 200 A' },
    material: { grade: 'S355' },
    units: 'kn',
    model: { span: 6, supportType: 'ss', includeSelfWeight: true },
    combination: {
      combination: 'en1990_610',
      psiQ1: 0.7,
      psiQ2: 0.7,
      customULSFactors: { G: 1.35, Q1: 1.5, Q2: 1.5 },
      customSLSFactors: { G: 1, Q1: 1, Q2: 0.7 },
      perCheckEnvelope: false,
      slsDeflectionBasis: 'total',
      slsIncludeSelfWeight: true
    },
    settings: {
      sectionClass: 2,
      gammaM0: 1,
      gammaM1: 1,
      deflectionLimit: 300,
      enableLTB: false,
      ltbRestraints: 0,
      ltbK: 1,
      ltbC1: 1,
      ltbC2: 0,
      ltbModel: 'rolled',
      bucklingKy: 1,
      bucklingKz: 1,
      bucklingCurveY: 'auto',
      bucklingCurveZ: 'auto'
    },
    loads: {
      udls: [
        { label: 'G load', x1: 0, x2: 6, G: 2, Q1: 0, Q2: 0 },
        { label: 'Q1 load', x1: 0, x2: 6, G: 0, Q1: 3, Q2: 0 },
        { label: 'Q2 load', x1: 0, x2: 6, G: 0, Q1: 0, Q2: 4 }
      ],
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

const baselineInput = baseInput();
const baseline = calculateBeam(baselineInput);

const ignoredCustomInput = clone(baselineInput);
ignoredCustomInput.combination.customULSFactors = { G: 2.5, Q1: 0.2, Q2: 0.1 };
ignoredCustomInput.combination.customSLSFactors = { G: 0, Q1: 0, Q2: 0 };
const ignoredCustom = calculateBeam(ignoredCustomInput);
approxEqual(ignoredCustom.summary.maxMoment, baseline.summary.maxMoment, 'Custom factors should not affect EN 1990 preset ULS moment');
approxEqual(ignoredCustom.summary.deflection, baseline.summary.deflection, 'Custom factors should not affect EN 1990 preset SLS deflection');

const customInput = clone(baselineInput);
customInput.combination.combination = 'custom_colbeam';
customInput.combination.customULSFactors = { G: 2, Q1: 2, Q2: 2 };
customInput.combination.customSLSFactors = { G: 1, Q1: 1, Q2: 0.7 };
const custom = calculateBeam(customInput);
assert.ok(custom.summary.maxMoment > baseline.summary.maxMoment, 'Custom ULS factors should increase ULS moment in custom mode.');
assert.deepStrictEqual(custom.loads.combinations.ulsCoefficients, { cG: 2, cQ1: 2, cQ2: 2 });

const customSlsLowInput = clone(customInput);
customSlsLowInput.combination.customULSFactors = { G: 1.35, Q1: 1.5, Q2: 1.5 };
customSlsLowInput.combination.customSLSFactors = { G: 0.2, Q1: 0.2, Q2: 0.2 };
const customSlsLow = calculateBeam(customSlsLowInput);
assert.ok(customSlsLow.summary.deflection < custom.summary.deflection, 'Custom SLS factors should change service deflection in custom mode.');
assert.deepStrictEqual(customSlsLow.loads.combinations.slsCoefficients, { cG: 0.2, cQ1: 0.2, cQ2: 0.2 });

const selfIncludedInput = clone(baselineInput);
selfIncludedInput.loads.udls = [];
selfIncludedInput.combination.slsDeflectionBasis = 'total';
selfIncludedInput.combination.slsIncludeSelfWeight = true;
const selfIncluded = calculateBeam(selfIncludedInput);
const selfExcludedInput = clone(selfIncludedInput);
selfExcludedInput.combination.slsIncludeSelfWeight = false;
const selfExcluded = calculateBeam(selfExcludedInput);
assert.ok(selfIncluded.summary.deflection > selfExcluded.summary.deflection, 'SLS self-weight exclusion should reduce deflection when only self-weight is present.');
assert.strictEqual(selfExcluded.loads.combinations.slsIncludeSelfWeight, false);

const imposedInput = clone(baselineInput);
imposedInput.combination.slsDeflectionBasis = 'imposed-only';
const imposed = calculateBeam(imposedInput);
const variableInput = clone(baselineInput);
variableInput.combination.slsDeflectionBasis = 'variable-only';
const variable = calculateBeam(variableInput);
const totalInput = clone(baselineInput);
totalInput.combination.slsDeflectionBasis = 'total';
const total = calculateBeam(totalInput);
assert.ok(variable.summary.deflection > imposed.summary.deflection, 'Variable-only should include secondary variable action and exceed imposed-only.');
assert.ok(total.summary.deflection > variable.summary.deflection, 'Total SLS should include permanent action and exceed variable-only for this case.');
assert.strictEqual(imposed.loads.combinations.slsDeflectionBasis, 'imposed-only');
assert.strictEqual(variable.loads.combinations.slsDeflectionBasis, 'variable-only');

assert.strictEqual(custom.loads.combinations.perCheckEnvelopeEngineWired, false);
assert.ok(custom.calculationPackage.warnings.some((warning) => warning.includes('Per-check EN 1990 6.10a/6.10b envelope remains metadata-only')));

console.log('colbeam stage4 engine wiring ok', {
  baselineMoment: baseline.summary.maxMoment,
  customMoment: custom.summary.maxMoment,
  totalDeflection: total.summary.deflection,
  variableDeflection: variable.summary.deflection,
  imposedDeflection: imposed.summary.deflection
});
