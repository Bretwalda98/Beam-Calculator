const assert = require('assert');
const { calculateBeam } = require('../services/calculation-service');
const { buildReportHtml, buildLatexReport } = require('../services/report-service');

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
assert.strictEqual(y.actions.axis.MyEd, 0);
assert.ok(y.actions.axis.MzEd > 0, 'Y-direction UDL should produce weak-axis MzEd when Iz exists.');
assert.ok(y.actions.axis.VyEd > 0, 'Y-direction UDL should produce weak-axis shear VyEd.');
assert.ok(y.actions.axis.yDeflection > 0, 'Y-direction UDL should produce y-deflection from the minor-axis SLS solve.');
assert.ok(y.diagrams.yDirectionGraphs.hasLoads, 'Y-only case should populate the Y-direction graph window.');
assert.ok(y.diagrams.yDirectionGraphs.series.some((row) => Math.abs(row.Mz) > 0), 'Y-direction graph series should contain Mz values.');
assert.ok(y.diagrams.yDirectionGraphs.series.some((row) => Math.abs(row.Vy) > 0), 'Y-direction graph series should contain Vy values.');
assert.strictEqual(y.diagrams.zDirectionGraphs.hasLoads, false, 'Y-only case should still expose an empty Z-direction graph window.');
assert.ok(/No Z-direction load/.test(y.diagrams.zDirectionGraphs.message), 'Y-only case should show a not-governing Z-direction graph message.');
assert.strictEqual(y.actions.axis.governingDirection, 'Y');
assert.ok(y.checks.minorAxis.available, 'Y-direction load should activate the weak-axis check.');

const legacyInput = clone(yInput);
delete legacyInput.loads.udls[0].direction;
const legacy = calculateBeam(legacyInput);
const defaultZ = calculateBeam(baseInput('Z'));
approxEqual(legacy.actions.axis.MyEd, defaultZ.actions.axis.MyEd, 'Missing legacy direction should default to Z-direction strong-axis action');
approxEqual(legacy.summary.maxMoment, defaultZ.summary.maxMoment, 'Missing legacy direction should preserve old strong-axis max moment');

const zInput = baseInput('Z');
const z = calculateBeam(zInput);
assert.ok(z.actions.axis.MyEd > 0, 'Z-direction UDL should produce strong-axis MyEd.');
assert.strictEqual(z.actions.axis.MzEd, 0);
assert.ok(z.actions.axis.VzEd > 0, 'Z-direction UDL should produce strong-axis shear VzEd.');
assert.ok(z.actions.axis.zDeflection > 0, 'Z-direction UDL should produce z-deflection from the strong-axis SLS solve.');
assert.ok(z.diagrams.zDirectionGraphs.hasLoads, 'Z-only case should populate the Z-direction graph window.');
assert.ok(z.diagrams.zDirectionGraphs.series.some((row) => Math.abs(row.My) > 0), 'Z-direction graph series should contain My values.');
assert.ok(z.diagrams.zDirectionGraphs.series.some((row) => Math.abs(row.Vz) > 0), 'Z-direction graph series should contain Vz values.');
assert.strictEqual(z.diagrams.yDirectionGraphs.hasLoads, false, 'Z-only case should still expose an empty Y-direction graph window.');
assert.ok(/No Y-direction load/.test(z.diagrams.yDirectionGraphs.message), 'Z-only case should show a not-governing Y-direction graph message.');
assert.strictEqual(z.actions.axis.yDeflection, 0);
assert.strictEqual(z.actions.axis.governingDirection, 'Z');
assert.strictEqual(z.checks.minorAxis.available, false);
assert.ok(/No explicit Y-direction loads/.test(z.checks.minorAxis.message), 'Z-only case should record that no Y load is applied.');
assert.ok(!(z.calculationPackage.warnings || []).some((warning) => /Minor-axis bending check not available/.test(warning)), 'Z-only case should not raise scary missing-property warnings.');

const mixedInput = baseInput('Y');
mixedInput.loads.udls.push({ label: 'Z UDL', direction: 'Z', x1: 0, x2: 6, G: 1, Q1: 0, Q2: 0 });
const mixed = calculateBeam(mixedInput);
assert.ok(mixed.actions.axis.MyEd > 0, 'Mixed Y/Z loads should retain strong-axis MyEd from Z direction.');
assert.ok(mixed.actions.axis.MzEd > 0, 'Mixed Y/Z loads should retain weak-axis MzEd from Y direction.');
assert.notStrictEqual(mixed.actions.axis.MyIR, mixed.actions.axis.MzIR, 'Mixed-axis checks should stay separate.');
assert.ok(mixed.diagrams.zDirectionGraphs.hasLoads && mixed.diagrams.yDirectionGraphs.hasLoads, 'Mixed Y/Z loads should populate both direction graph windows.');

const completeMinorInput = baseInput('Y');
completeMinorInput.section = { family: 'HEA', name: 'HE 200 A' };
const completeMinor = calculateBeam(completeMinorInput);
assert.strictEqual(completeMinor.checks.minorAxis.available, true);
assert.ok(completeMinor.actions.axis.MzRd > 0, 'Completed dataset should provide HE 200 A MzRd.');
assert.ok(completeMinor.actions.axis.VyRd > 0, 'Completed dataset should provide HE 200 A Y-direction shear resistance from Avy.');
assert.strictEqual(completeMinor.actions.axis.shearEta.y.shearAreaSource, 'Avy_mm2');
assert.ok(completeMinor.sectionProperties.Avy_mm2 > 0, 'Completed dataset should expose Avy in section properties.');

const customY = baseInput('Y');
customY.combination.combination = 'custom_colbeam';
customY.combination.customULSFactors = { G: 2, Q1: 2, Q2: 2 };
const customYResult = calculateBeam(customY);
assert.ok(customYResult.actions.axis.MzEd > y.actions.axis.MzEd, 'Stage 4 custom ULS factors should still affect Y-direction weak-axis actions.');

const customZ = baseInput('Z');
customZ.combination.combination = 'custom_colbeam';
customZ.combination.customULSFactors = { G: 2, Q1: 2, Q2: 2 };
const customZResult = calculateBeam(customZ);
assert.ok(customZResult.actions.axis.MyEd > z.actions.axis.MyEd, 'Stage 4 custom ULS factors should still affect Z-direction strong-axis actions.');

const reportHtml = buildReportHtml(mixedInput, mixed);
const handCalc = buildLatexReport(mixedInput, mixed);
assert.ok(reportHtml.includes('Z-direction loading - strong-axis bending My / shear Vz'), 'Report should include Z-direction strong-axis overview.');
assert.ok(reportHtml.includes('Y-direction loading - weak-axis bending Mz / shear Vy'), 'Report should include Y-direction weak-axis overview.');
assert.ok(reportHtml.includes('Vz(x) - Z-direction shear'), 'Report should include Z-direction Vz graph label.');
assert.ok(reportHtml.includes('My(x) - strong-axis bending'), 'Report should include Z-direction My graph label.');
assert.ok(reportHtml.includes('z-deflection'), 'Report should include Z-direction deflection label.');
assert.ok(reportHtml.includes('Vy(x) - Y-direction shear'), 'Report should include Y-direction Vy graph label.');
assert.ok(reportHtml.includes('Mz(x) - weak-axis bending'), 'Report should include Y-direction Mz graph label.');
assert.ok(reportHtml.includes('y-deflection'), 'Report should include Y-direction deflection label.');
assert.ok(handCalc.includes('Z-direction loading -- strong-axis bending My / shear Vz'), 'Hand calculation should include Z-direction strong-axis section.');
assert.ok(handCalc.includes('Y-direction loading -- weak-axis bending Mz / shear Vy'), 'Hand calculation should include Y-direction weak-axis section.');
assert.ok(handCalc.includes('Vz(x), My(x), and z-deflection'), 'Hand calculation should describe Z-direction graph labels.');
assert.ok(handCalc.includes('Vy(x), Mz(x), and y-deflection'), 'Hand calculation should describe Y-direction graph labels.');
assert.ok(!/colbeam/i.test(reportHtml), 'Report output must not expose forbidden reference wording.');
assert.ok(!/colbeam/i.test(handCalc), 'Hand calculation output must not expose forbidden reference wording.');

console.log('colbeam stage5 load directions ok', {
  zMyEd: z.actions.axis.MyEd,
  yMzEd: y.actions.axis.MzEd,
  yMzRd: y.actions.axis.MzRd,
  mixedGoverningDirection: mixed.actions.axis.governingDirection,
  completeMinorMzRd: completeMinor.actions.axis.MzRd,
  completeMinorVyRd: completeMinor.actions.axis.VyRd
});
