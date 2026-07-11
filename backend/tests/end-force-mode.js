'use strict';

const assert = require('assert');
const { calculateBeam, UNIT_DEFS } = require('../services/calculation-service');
const { validateCalculationRequest } = require('../services/validation-service');
const { buildReportHtml, buildLatexReport, buildHandCalculationPdf } = require('../services/report-service');
const { buildDirectActionProfiles, normaliseAnalysisInputMode } = require('../services/direct-action-service');

const endForces = {
  N_kN: 100,
  My1_kNm: 100,
  My2_kNm: 120,
  Mz1_kNm: -10,
  Mz2_kNm: 30,
  Vz1_kN: 50,
  Vz2_kN: -100,
  Vy1_kN: 20,
  Vy2_kN: 1000
};

function input(overrides = {}) {
  return {
    version: 2,
    analysisInputMode: 'endForces',
    endForces: { ...endForces },
    section: { family: 'IPE', name: 'IPE100' },
    material: { grade: 'S355' },
    units: 'kn',
    model: { analysisMode: 'single', span: 6, supportType: 'ss', includeSelfWeight: false },
    combination: { combination: 'en1990_610', psiQ1: 0.7, psiQ2: 0.7 },
    settings: { sectionClass: 2, gammaM0: 1, gammaM1: 1, deflectionLimit: 300, enableLTB: false },
    axial: { G: 9000, Q1: 8000, Q2: 7000 },
    loads: { udls: [{ direction: 'Z', x1: 0, x2: 6, G: 999 }], points: [] },
    ...overrides
  };
}

function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, received ${actual}`);
}

const profile = buildDirectActionProfiles(endForces, 6, 25);
assert.ok(profile.series.every((row) => row.N === 100), 'N must be constant and signed positive for compression.');
close(profile.peaks.My.val, 120, 'My peak');
assert.strictEqual(profile.peaks.My.end, 'End 2');
close(profile.peaks.Mz.val, 30, 'Mz peak');
close(profile.zeroCrossings.Mz, 1.5, 'Mz zero crossing at 0.25L');
close(profile.peaks.Vz.val, 100, 'Vz peak');
close(profile.peaks.Vz.signed, -100, 'Vz signed peak');
close(profile.zeroCrossings.Vz, 2, 'Vz zero crossing at L/3');
close(profile.peaks.Vy.val, 1000, 'Vy peak');
assert.strictEqual(profile.series[0].Mz, -10, 'End 1 sign must be preserved.');
assert.strictEqual(profile.series.at(-1).Vz, -100, 'End 2 sign must not be reversed.');

validateCalculationRequest(input());
assert.throws(() => validateCalculationRequest(input({ model: { analysisMode: 'multi', span: 6, supportType: 'ss' } })), /single-member, single-span/);
assert.strictEqual(normaliseAnalysisInputMode(undefined), 'appliedLoads', 'Old projects must migrate to applied-load mode.');

const first = calculateBeam(input());
const changedCombination = calculateBeam(input({ combination: { combination: 'basic', psiQ1: 0.1, psiQ2: 0.2 } }));
assert.strictEqual(first.analysisInputMode, 'endForces');
assert.strictEqual(first.inputEcho.analysisInputModeLabel, 'Member end forces');
assert.deepStrictEqual(first.actions.directProfile.peaks, changedCombination.actions.directProfile.peaks, 'Load-combination selection must not alter direct actions.');
assert.deepStrictEqual(first.actions.axis, changedCombination.actions.axis, 'Load-combination selection must not alter direct action demands/resistances.');
assert.strictEqual(first.actions.reactions.length, 0, 'Direct mode must not return calculated reactions.');
assert.strictEqual(first.summary.maxReaction, null, 'Direct mode must not label end shears as reactions.');
assert.strictEqual(first.summary.maxEndShear, 1000);
assert.strictEqual(first.summary.deflection, null);
assert.strictEqual(first.checks.deflection.available, false);
assert.ok(first.checks.conservativeInteraction.enabled, 'Direct mode must include the existing conservative N+My+Mz cross-section interaction.');
assert.ok(first.checks.minorAxis.available, 'Complete IPE data must support Mz/Vy checks.');
assert.ok(first.sectionProperties.biaxialProvenance.Avy_mm2.isDerived, 'Derived Avy provenance must be explicit.');
assert.match(first.loads.combinations.note, /No load-combination factors applied/);

const tonne = calculateBeam(input({ units: 'tonne' }));
close(tonne.actions.directProfile.peaks.My.val, 120, 'Base My must survive display-unit switching');
close(UNIT_DEFS.tonne.toBaseForce(UNIT_DEFS.tonne.fromBaseForce(100)), 100, 'Force unit round trip');
close(UNIT_DEFS.tonne.toBaseMoment(UNIT_DEFS.tonne.fromBaseMoment(120)), 120, 'Moment unit round trip');

const html = buildReportHtml(input(), first, {});
const latex = buildLatexReport(input(), first, {});
const handPdf = buildHandCalculationPdf(input(), first, {});
assert.ok(Buffer.isBuffer(handPdf) && handPdf.subarray(0, 4).toString() === '%PDF', 'Hand calculation must compile to a PDF buffer.');
assert.match(handPdf.toString('latin1'), /Member end forces/);
[html, latex].forEach((output) => {
  assert.match(output, /Member end forces/);
  assert.match(output, /No load-combination factors applied/);
  assert.match(output, /My1/);
  assert.match(output, /Mz1/);
  assert.match(output, /Vz1/);
  assert.match(output, /Vy1/);
  assert.match(output, /Deflection not calculated for direct end-force mode/);
});

const oldApplied = input({ analysisInputMode: undefined, endForces: undefined, axial: { G: 0, Q1: 0, Q2: 0 } });
oldApplied.loads = { udls: [{ direction: 'Z', x1: 0, x2: 6, G: 1 }], points: [] };
const oldResult = calculateBeam(oldApplied);
assert.strictEqual(oldResult.analysisInputMode, 'appliedLoads');
assert.ok(oldResult.actions.reactions.length > 0, 'Existing applied-load solver must remain active for migrated projects.');

console.log('End-force mode regression tests passed.');
