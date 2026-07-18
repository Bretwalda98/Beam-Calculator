'use strict';

const assert = require('assert');
const { createSpecialSectionAdapter, specialSectionAdapter } = require('../services/external-special-section-adapter');
const {
  listPublicSections,
  getSectionById,
  buildSectionProfileSnapshot,
  catalogueRevision
} = require('../services/sections-service');

assert.strictEqual(catalogueRevision(), '73360d0357bb6d7c9173c11aa630ab8bb81c48bae84cb2bbe87c33294df93678', 'Canonical production section data changed unexpectedly.');
const catalogueSections = listPublicSections();
assert.strictEqual(catalogueSections.length, 368, 'Production section count must remain unchanged.');
const solidProfiles = catalogueSections.map(({ id }) => buildSectionProfileSnapshot(getSectionById(id)));
assert.strictEqual(solidProfiles.filter(Boolean).length, 368, 'Every production section requires a Solid-mode profile snapshot.');
assert.strictEqual(solidProfiles.filter(({ geometryVerified }) => geometryVerified).length, 368, 'Every Solid-mode profile must retain verified source geometry provenance.');
assert.deepStrictEqual([...new Set(solidProfiles.map(({ dimensions }) => dimensions.flangeSlopePercent))].sort((a, b) => a - b), [0, 5, 8, 14]);
const nominalAreaDifferences = solidProfiles.map((profile) => {
  const dimensions = profile.dimensions;
  const nominalArea = profile.kind === 'rhs'
    ? dimensions.height * dimensions.width -
      (dimensions.height - 2 * dimensions.wallThickness) * (dimensions.width - 2 * dimensions.wallThickness)
    : 2 * dimensions.width * dimensions.flangeThickness +
      dimensions.webThickness * (dimensions.height - 2 * dimensions.flangeThickness);
  return Math.abs(nominalArea - profile.properties.area) / profile.properties.area;
});
assert.ok(Math.max(...nominalAreaDifferences) < 0.1, 'Every nominal native profile must remain within the explicit 10% catalogue-area safety gate.');
assert.deepStrictEqual(specialSectionAdapter.list(), [], 'Bundled external special-section dataset must be empty.');

const verified = {
  id: 'FIXTURE-L-100X75X8', family: 'rolled_angle', designation: 'Fixture L 100x75x8', standard: 'Test fixture',
  source: { name: 'Verified test fixture', reference: 'TEST-ONLY', revisionDate: '2026-07-12' }, verified: true,
  units: { length: 'mm', area: 'mm2', sectionModulus: 'mm3', inertia: 'mm4', warping: 'mm6', mass: 'kg/m' },
  dimensions: { legY_mm: 100, legZ_mm: 75, thickness_mm: 8 },
  properties: {
    A_mm2: 1300, mass_kg_m: 10.2, Iy_mm4: 1000000, Iz_mm4: 500000,
    Wel_y_top_mm3: 20000, Wel_y_bottom_mm3: 18000, Wel_z_left_mm3: 14000, Wel_z_right_mm3: 12000,
    Wpl_y_mm3: null, Wpl_z_mm3: null, Avy_mm2: null, Avz_mm2: null, It_mm4: null, Iw_mm6: null,
    centroid_y_mm: 30, centroid_z_mm: 24, shear_centre_y_mm: null, shear_centre_z_mm: null
  }, qualityNotes: ['Automated fixture only; never production data.']
};
const adapter = createSpecialSectionAdapter({ schemaVersion: 1, records: [verified] });
assert.strictEqual(adapter.list('rolled_angle').length, 1);
assert.strictEqual(adapter.get(verified.id).designation, verified.designation);
assert.throws(() => adapter.require('nearest-or-similar', 'rolled_angle'), /not available/);
assert.throws(() => createSpecialSectionAdapter({ schemaVersion: 1, records: [{ ...verified, verified: false }] }), /not verified/);
assert.throws(() => createSpecialSectionAdapter({ schemaVersion: 1, records: [{ ...verified, units: { ...verified.units, inertia: 'cm4' } }] }), /must be mm4/);
assert.throws(() => createSpecialSectionAdapter({ schemaVersion: 1, records: [{ ...verified, properties: { ...verified.properties, mass_kg_m: 1000 } }] }), /physically inconsistent/);
assert.throws(() => createSpecialSectionAdapter({ schemaVersion: 1, records: [verified, verified] }), /Duplicate/);

console.log('special-section data boundary ok', { catalogueRows: 368, externalRows: 0 });
