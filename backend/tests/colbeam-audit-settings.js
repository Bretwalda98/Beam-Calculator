const assert = require('assert');
const { validateCalculationRequest } = require('../services/validation-service');
const { calculateBeam } = require('../services/calculation-service');

const baseInput = {
  section: { family: 'HEA', name: 'HE 200 A' },
  material: { grade: 'S355' },
  units: 'tonne',
  model: { span: 6, supportType: 'ss', includeSelfWeight: true },
  combination: { combination: 'en1990_610', psiQ1: 0.7, psiQ2: 0.7 },
  settings: {
    sectionClass: 2,
    gammaM0: 1,
    gammaM1: 1,
    deflectionLimit: 300,
    enableLTB: true,
    ltbRestraints: 0,
    ltbK: 1,
    ltbC1: 1,
    ltbC2: 0,
    ltbModel: 'rolled'
  },
  loads: {
    udls: [{ label: 'G UDL', x1: 0, x2: 6, G: 2, Q1: 0, Q2: 0 }],
    points: []
  },
  axial: { G: 0, Q1: 0, Q2: 0 }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

validateCalculationRequest(baseInput);
const oldResult = calculateBeam(baseInput);
assert.strictEqual(oldResult.inputEcho.colbeamAudit.combination.slsDeflectionBasis, 'total');
assert.strictEqual(oldResult.inputEcho.colbeamAudit.axial.signConvention, 'positive_compression');
assert.ok(oldResult.calculationPackage.warnings.some((warning) => warning.includes('does not claim reference-software parity')));

const newInput = clone(baseInput);
newInput.model.colbeamSupportMappingLabel = 'Reference pinned-pinned equivalent';
newInput.model.supportEquivalenceNote = 'Mapped to simply supported for this audit case.';
newInput.combination.customULSFactors = { G: 1.2, Q1: 1.4, Q2: 1.1 };
newInput.combination.customSLSFactors = { G: 1, Q1: 0.8, Q2: 0.6 };
newInput.combination.perCheckEnvelope = true;
newInput.combination.slsDeflectionBasis = 'imposed-only';
newInput.combination.slsIncludeSelfWeight = false;
newInput.settings.colbeamAudit = {
  auditProfile: 'advanced_ec3',
  materialVariantLabel: 'S355 NL',
  nationalAnnexLabel: 'UK NA',
  coefficientSource: 'Advanced EC3 audit setup',
  autoSectionClassificationStatus: 'pending',
  class4EffectivePropertiesMode: 'manual',
  shearFactorEta: 1,
  class12ElasticDesign: true,
  conservativeNMyMz: true,
  flangeBucklingIgnored: true,
  webBucklingIgnored: true,
  ltbC3: 0.2,
  ltbKw: 1.1,
  ltbLoadHeight: 'top_flange',
  ltbShearCentreConvention: 'top flange load treated as destabilising',
  ltbRestraintModel: 'colbeam',
  ltbMomentGradientMethod: 'colbeam_default',
  lambdaLT0: 0.4,
  beta: 0.75,
  memberBucklingInteractionMethod: 'colbeam',
  colbeamInteractionMethodLabel: 'Reference EC3 interaction',
  supportBearingModel: 'colbeam_metadata',
  webBearingModel: 'colbeam_metadata',
  stiffenerModel: 'colbeam_metadata',
  modalAnalysisStatus: 'not implemented'
};
newInput.loads.udls[0].direction = 'Y';
newInput.loads.points.push({ label: 'Point Q1', direction: 'Z', x: 3, G: 0, Q1: 1, Q2: 0 });
newInput.axial.signConvention = 'positive_compression';

validateCalculationRequest(newInput);
const newResult = calculateBeam(newInput);
assert.strictEqual(newResult.inputEcho.colbeamAudit.model.colbeamSupportMappingLabel, 'Reference pinned-pinned equivalent');
assert.strictEqual(newResult.inputEcho.colbeamAudit.combination.customULSFactors.G, 1.2);
assert.strictEqual(newResult.inputEcho.colbeamAudit.combination.perCheckEnvelope, true);
assert.strictEqual(newResult.inputEcho.colbeamAudit.combination.slsDeflectionBasis, 'imposed-only');
assert.strictEqual(newResult.inputEcho.colbeamAudit.settings.auditProfile, 'advanced_ec3');
assert.strictEqual(newResult.inputEcho.colbeamAudit.settings.ltbLoadHeight, 'top_flange');
assert.strictEqual(newResult.inputEcho.colbeamAudit.settings.memberBucklingInteractionMethod, 'colbeam');
assert.ok(newResult.loads.raw.udls.some((load) => load.direction === 'Y'));
assert.ok(newResult.loads.colbeamAudit.directions.udls.some((load) => load.direction === 'Y'));
assert.strictEqual(newResult.calculationPackage.colbeamAudit.settings.materialVariantLabel, 'S355 NL');
assert.strictEqual(newResult.calculationPackage.colbeamAudit.combination.customSLSFactors.Q2, 0.6);
assert.ok(newResult.calculationPackage.warnings.some((warning) => warning.includes('Per-check EN 1990 6.10a/6.10b envelope remains metadata-only')));
assert.ok(newResult.calculationPackage.warnings.some((warning) => warning.includes('LTB C3, kw, load-height')));

assert.throws(() => validateCalculationRequest({
  ...clone(baseInput),
  loads: { udls: [{ label: 'Bad direction', direction: 'X', x1: 0, x2: 6, G: 1 }], points: [] }
}), /direction must be Y or Z/);

console.log('colbeam audit settings ok', {
  oldRequestDefaultBasis: oldResult.inputEcho.colbeamAudit.combination.slsDeflectionBasis,
  newRequestProfile: newResult.inputEcho.colbeamAudit.settings.auditProfile,
  metadataWarnings: newResult.calculationPackage.warnings.filter((warning) => warning.includes('metadata-only')).length
});
