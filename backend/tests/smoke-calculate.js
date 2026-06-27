const assert = require('assert');
const { calculateBeam } = require('../services/calculation-service');

const result = calculateBeam({
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
    udls: [{ label: 'Test UDL', x1: 0, x2: 6, G: 2, Q1: 0, Q2: 0 }],
    points: []
  },
  axial: { G: 0, Q1: 0, Q2: 0 }
});

assert.ok(result.calculationId);
assert.ok(['PASS', 'FAIL'].includes(result.status));
assert.ok(result.summary.maxMoment > 0);
assert.ok(result.summary.maxShear > 0);
assert.ok(result.diagrams.series.length > 10);
assert.ok(result.source.title);

console.log('server calculation smoke ok', {
  status: result.status,
  governingIR: result.summary.governingIR,
  maxMoment: result.summary.maxMoment
});
