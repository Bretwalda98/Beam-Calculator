'use strict';

const assert = require('assert');
const { deriveCompositeProperties, derivePlateSubtype } = require('../services/special-section-geometry');
const { resolveSpecialSectionDefinition } = require('../services/special-section-service');

function close(actual, expected, tolerance = 1e-6, label = 'value') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, received ${actual}`);
}

const tee = derivePlateSubtype('plate_flatbar', {
  webHeight_mm: 100, webThickness_mm: 10, flangeWidth_mm: 100, flangeThickness_mm: 10
});
close(tee.A_mm2, 2000, 1e-9, 'T area');
close(tee.mass_kg_m, 15.7, 1e-9, 'T mass');
close(tee.centroid_y_mm, 0, 1e-9, 'T centroid y');
close(tee.centroid_z_mm, 77.5, 1e-9, 'T centroid z');
close(tee.Iy_mm4, 2354166.6666666665, 1e-6, 'T Iy by parallel axis');
close(tee.Iz_mm4, 841666.6666666666, 1e-6, 'T Iz by parallel axis');
close(tee.Wel_y_top_mm3, tee.Iy_mm4 / 32.5, 1e-6, 'T Wel top');
close(tee.Wel_y_bottom_mm3, tee.Iy_mm4 / 77.5, 1e-6, 'T Wel bottom');
close(tee.plasticNeutralAxis_z_mm, 100, 1e-7, 'T plastic neutral axis');
close(tee.Wpl_y_mm3, 55000, 1e-5, 'T plastic modulus y');
close(tee.Wpl_z_mm3, 27500, 1e-5, 'T plastic modulus z');
assert.notStrictEqual(tee.Wel_y_top_mm3, tee.Wel_y_bottom_mm3, 'Asymmetric extreme-fibre moduli must remain separate.');

const asymmetricI = derivePlateSubtype('welded_i_single_symmetric', {
  clearWebHeight_mm: 100,
  webThickness_mm: 10,
  topFlangeWidth_mm: 100,
  topFlangeThickness_mm: 10,
  bottomFlangeWidth_mm: 50,
  bottomFlangeThickness_mm: 20,
  ignoredInactiveValue_mm: 999999
});
const withoutInactive = derivePlateSubtype('welded_i_single_symmetric', {
  clearWebHeight_mm: 100,
  webThickness_mm: 10,
  topFlangeWidth_mm: 100,
  topFlangeThickness_mm: 10,
  bottomFlangeWidth_mm: 50,
  bottomFlangeThickness_mm: 20
});
close(asymmetricI.A_mm2, 3000, 1e-9, 'Asymmetric I area');
close(asymmetricI.centroid_z_mm, 68.33333333333333, 1e-9, 'Asymmetric I centroid');
close(asymmetricI.Iy_mm4, withoutInactive.Iy_mm4, 1e-9, 'Inactive subtype values excluded');
assert.notStrictEqual(asymmetricI.Wel_y_top_mm3, asymmetricI.Wel_y_bottom_mm3);

assert.throws(() => deriveCompositeProperties([
  { id: 'a', y0: 0, z0: 0, width: 20, height: 20 },
  { id: 'b', y0: 10, z0: 10, width: 20, height: 20 }
]), /overlap by 100.000 mm2/);

const bulbMissing = resolveSpecialSectionDefinition({
  source: 'stiff_plate', subtype: 'plate_bulb_flat', dimensions: {}, componentRefs: { profileRecordId: 'NOT-THERE' }
});
assert.strictEqual(bulbMissing.status, 'DATA_REQUIRED');
assert.match(bulbMissing.message, /No verified bulb flat/);

const axialT = resolveSpecialSectionDefinition({
  source: 'welded', subtype: 'welded_t_axial',
  dimensions: { webHeight_mm: 100, webThickness_mm: 10, flangeWidth_mm: 100, flangeThickness_mm: 10 }
});
assert.strictEqual(axialT.status, 'GEOMETRY_DERIVED');
assert.strictEqual(axialT.axialOnly, true);
assert.ok(axialT.missingProperties.some((item) => item.startsWith('Avy_mm2')));

console.log('special-section geometry ok', { teeArea: tee.A_mm2, teeIy: tee.Iy_mm4, asymmetricCentroid: asymmetricI.centroid_z_mm });
