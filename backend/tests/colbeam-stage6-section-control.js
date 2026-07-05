const assert = require('assert');
const { PROFILE_DB } = require('../data/sections-database');
const { calculateBeam } = require('../services/calculation-service');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function approxEqual(actual, expected, label, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= Math.max(tolerance, Math.abs(expected) * tolerance), `${label}: expected ${actual} to equal ${expected}`);
}

function baseInput(direction = 'Y') {
  return {
    section: { family: 'IPE', name: 'IPE100' },
    material: { grade: 'S355' },
    units: 'kn',
    model: { span: 6, supportType: 'ss', includeSelfWeight: false },
    combination: {
      combination: 'custom_colbeam',
      psiQ1: 0.7,
      psiQ2: 0.7,
      customULSFactors: { G: 1, Q1: 0, Q2: 0 },
      customSLSFactors: { G: 1, Q1: 0, Q2: 0 },
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
      bucklingCurveZ: 'auto',
      colbeamAudit: {
        shearFactorEta: 1,
        class12ElasticDesign: false,
        conservativeNMyMz: false,
        flangeBucklingIgnored: false,
        webBucklingIgnored: false
      }
    },
    loads: {
      udls: [{ label: `${direction} UDL`, direction, x1: 0, x2: 6, G: 1, Q1: 0, Q2: 0 }],
      points: []
    },
    axial: { G: 0, Q1: 0, Q2: 0 }
  };
}

const baseline = calculateBeam(baseInput('Y'));

const etaInput = baseInput('Y');
etaInput.settings.colbeamAudit.shearFactorEta = 1.5;
const eta = calculateBeam(etaInput);
assert.ok(eta.checks.shear.resistance > baseline.checks.shear.resistance, 'Eta should increase major-axis shear resistance where Avz exists.');
approxEqual(eta.checks.shear.resistance, baseline.checks.shear.resistance * 1.5, 'Eta should scale major-axis shear resistance', 1e-5);
assert.strictEqual(eta.checks.sectionControlSettings.shearFactorEta.majorAxisUsed, 1.5);

const elasticInput = baseInput('Y');
elasticInput.settings.colbeamAudit.class12ElasticDesign = true;
const elastic = calculateBeam(elasticInput);
assert.ok(elastic.checks.moment.resistance < baseline.checks.moment.resistance, 'Class 1-2 elastic toggle should reduce MyRd when Wel,y < Wpl,y.');
assert.strictEqual(elastic.checks.sectionControlSettings.bendingResistanceBasis.MyRdBasis, 'Wel,y');

const zPlastic = calculateBeam(baseInput('Z'));
const zElasticInput = baseInput('Z');
zElasticInput.settings.colbeamAudit.class12ElasticDesign = true;
const zElastic = calculateBeam(zElasticInput);
assert.ok(zElastic.checks.minorAxis.momentResistance < zPlastic.checks.minorAxis.momentResistance, 'Class 1-2 elastic toggle should reduce MzRd when Wel,z < Wpl,z.');
assert.strictEqual(zElastic.checks.sectionControlSettings.bendingResistanceBasis.MzRdBasis, 'Wel,z');
assert.ok(zElastic.checks.minorAxis.warnings.some((warning) => warning.includes('Avy')), 'Missing Avy warning should remain visible for minor-axis shear.');

PROFILE_DB.TEST_STAGE6 = [{
  name: 'MISSING_AVZ',
  h_mm: 100,
  b_mm: 50,
  mass_kg_m: 10,
  A_mm2: 1274,
  Iy_mm4: 1000000,
  Iz_mm4: 200000,
  Wel_y_mm3: 20000,
  Wpl_y_mm3: 25000,
  Wel_z_mm3: 6000,
  Wpl_z_mm3: 8000
}, {
  name: 'MISSING_WEL',
  h_mm: 100,
  b_mm: 50,
  mass_kg_m: 10,
  A_mm2: 1274,
  Avz_mm2: 500,
  Iy_mm4: 1000000,
  Iz_mm4: 200000,
  Wpl_y_mm3: 25000,
  Wpl_z_mm3: 8000
}];

const missingAvzInput = baseInput('Y');
missingAvzInput.section = { family: 'TEST_STAGE6', name: 'MISSING_AVZ' };
missingAvzInput.settings.colbeamAudit.shearFactorEta = 1.5;
const missingAvz = calculateBeam(missingAvzInput);
assert.strictEqual(missingAvz.checks.shear.pass, false);
assert.ok(missingAvz.checks.sectionControlSettings.shearFactorEta.majorAxisNotUsedReason.includes('Avz'), 'Missing Avz should warn and not use eta.');
assert.ok(missingAvz.calculationPackage.warnings.some((warning) => warning.includes('Avz')), 'Missing Avz warning should be present in calculation package.');

const missingWelInput = baseInput('Y');
missingWelInput.section = { family: 'TEST_STAGE6', name: 'MISSING_WEL' };
missingWelInput.settings.colbeamAudit.class12ElasticDesign = true;
const missingWel = calculateBeam(missingWelInput);
assert.strictEqual(missingWel.checks.moment.pass, false);
assert.ok(missingWel.calculationPackage.warnings.some((warning) => warning.includes('Wel_y_mm3')), 'Missing Wel,y should warn rather than using Wpl,y.');

const conservativeInput = baseInput('Y');
conservativeInput.loads.udls.push({ label: 'Z UDL', direction: 'Z', x1: 0, x2: 6, G: 1, Q1: 0, Q2: 0 });
conservativeInput.axial.G = 1;
conservativeInput.settings.deflectionLimit = 50;
conservativeInput.settings.colbeamAudit.conservativeNMyMz = true;
const conservative = calculateBeam(conservativeInput);
assert.ok(conservative.checks.conservativeInteraction.available, 'Conservative N+My+Mz check should be available when all values exist.');
assert.ok(conservative.checks.conservativeInteraction.ir > conservative.checks.moment.ir, 'Conservative interaction should exceed major-axis moment utilisation for this case.');
approxEqual(conservative.summary.governingIR, conservative.checks.conservativeInteraction.ir, 'Conservative interaction should govern when it is the largest ratio', 1e-5);

const conservativeMissingInput = baseInput('Y');
conservativeMissingInput.settings.colbeamAudit.conservativeNMyMz = true;
const conservativeMissing = calculateBeam(conservativeMissingInput);
assert.strictEqual(conservativeMissing.checks.conservativeInteraction.available, false);
assert.ok(conservativeMissing.checks.conservativeInteraction.warnings.some((warning) => warning.includes('MzRd')), 'Conservative check should warn when MzRd is missing.');

const defaultAgain = calculateBeam(baseInput('Y'));
approxEqual(defaultAgain.summary.maxMoment, baseline.summary.maxMoment, 'Default Stage 6 settings should preserve Stage 5 moment.');
approxEqual(defaultAgain.checks.moment.resistance, baseline.checks.moment.resistance, 'Default Stage 6 settings should preserve plastic MyRd.');

const stage4Custom = baseInput('Y');
stage4Custom.combination.customULSFactors = { G: 2, Q1: 0, Q2: 0 };
const stage4CustomResult = calculateBeam(stage4Custom);
assert.ok(stage4CustomResult.summary.maxMoment > baseline.summary.maxMoment, 'Stage 4 custom factors should still affect actions.');

const stage5Z = calculateBeam(baseInput('Z'));
assert.ok(stage5Z.actions.axis.MzEd > 0, 'Stage 5 Z-direction action mapping should still work.');

console.log('colbeam stage6 section control ok', {
  plasticMyRd: baseline.checks.moment.resistance,
  elasticMyRd: elastic.checks.moment.resistance,
  plasticMzRd: zPlastic.checks.minorAxis.momentResistance,
  elasticMzRd: zElastic.checks.minorAxis.momentResistance,
  etaVyRd: eta.checks.shear.resistance,
  conservativeIR: conservative.checks.conservativeInteraction.ir
});
