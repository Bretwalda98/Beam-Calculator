'use strict';

const assert = require('assert');
const { calculateBeam } = require('../services/calculation-service');
const { validateCalculationRequest } = require('../services/validation-service');
const { buildReportHtml, buildLatexReport, buildHandCalculationPdf } = require('../services/report-service');
const { normaliseSectionDefinition } = require('../services/special-section-service');

function baseInput(sectionDefinition, overrides = {}) {
  return {
    version: 3,
    sectionDefinition,
    section: { family: 'SPECIAL', name: sectionDefinition.settings?.name || 'Special fixture' },
    material: { grade: 'S355' }, units: 'kn', analysisInputMode: 'appliedLoads',
    model: { analysisMode: 'single', span: 6, supportType: 'ss', includeSelfWeight: false },
    combination: { combination: 'basic' },
    settings: { sectionClass: 2, gammaM0: 1, gammaM1: 1, deflectionLimit: 300, enableLTB: false },
    axial: { rows: [] },
    loads: { udls: [{ x1: 0, x2: 6, direction: 'Z', G: 1, Q1: 0, Q2: 0 }], points: [] },
    ...overrides
  };
}

const weldedI = {
  source: 'welded', subtype: 'welded_i_double_symmetric',
  dimensions: { clearWebHeight_mm: 200, webThickness_mm: 8, topFlangeWidth_mm: 150, topFlangeThickness_mm: 12 },
  settings: { name: 'Welded I fixture' }
};
const input = baseInput(weldedI);
validateCalculationRequest(input);
const result = calculateBeam(input);
assert.strictEqual(result.status, 'INCOMPLETE');
assert.strictEqual(result.inputEcho.sectionDefinition.source, 'welded');
assert.strictEqual(result.sectionProperties.specialSection.status, 'GEOMETRY_DERIVED');
assert.strictEqual(result.checks.moment.available, false, 'Unverified family resistance selection must not return a bending PASS.');
assert.strictEqual(result.checks.moment.pass, null);
assert.strictEqual(result.checks.shear.pass, false, 'Missing Avz must block only the dependent shear check.');
assert.ok(result.checks.incompleteReasons.some((reason) => reason.includes('Avz')));
assert.ok(result.calculationPackage.warnings.some((reason) => reason.includes('classification')));
assert.ok(result.calculationPackage.calculations.some((calculation) => calculation.id === 'special-section-geometry'));
const report = buildReportHtml(input, result, {});
const latex = buildLatexReport(input, result, {});
const handPdf = buildHandCalculationPdf(input, result, {});
assert.ok(Buffer.isBuffer(handPdf) && handPdf.subarray(0, 4).toString() === '%PDF', 'Special-section hand calculation must compile to PDF.');
[report, latex].forEach((output) => {
  assert.match(output, /Special Section Definition|special-section gross geometry|Special-section gross geometry/i);
  assert.match(output, /INCOMPLETE/);
  assert.match(output, /Avz/);
});
assert.strictEqual(normaliseSectionDefinition({ section: { family: 'HEA', name: 'HE 200 A' } }).source, 'catalogue', 'Older requests must migrate to catalogue definitions.');

const class4 = calculateBeam(baseInput(weldedI, { settings: { ...input.settings, sectionClass: 4 } }));
assert.strictEqual(class4.status, 'INCOMPLETE');
assert.ok(class4.checks.incompleteReasons.some((reason) => reason.includes('Class 4 effective properties')));

const axialT = {
  source: 'welded', subtype: 'welded_t_axial',
  dimensions: { webHeight_mm: 200, webThickness_mm: 10, flangeWidth_mm: 150, flangeThickness_mm: 12 },
  settings: { name: 'Axial T fixture' }
};
assert.throws(() => calculateBeam(baseInput(axialT)), /Axial loading only/);
const axialOnly = baseInput(axialT, {
  model: { analysisMode: 'single', span: 6, supportType: 'ss', includeSelfWeight: false },
  loads: { udls: [], points: [] },
  axial: { rows: [{ loadCase: 'G', forceType: 'tension', value: 50 }] }
});
const axialResult = calculateBeam(axialOnly);
assert.strictEqual(axialResult.status, 'INCOMPLETE');
assert.strictEqual(axialResult.sectionProperties.specialSection.axialOnly, true);

const missingProfile = baseInput({ source: 'stiff_plate', subtype: 'plate_bulb_flat', componentRefs: { profileRecordId: 'MISSING' }, settings: {} });
assert.throws(() => calculateBeam(missingProfile), /No verified bulb flat section data loaded/);

console.log('special-section calculation integration ok', { status: result.status, area: result.sectionProperties.A_mm2 });
