'use strict';

const completeProperties = require('../../artifacts/section-properties/complete-section-properties.json');

const bySection = new Map(completeProperties.map((row) => [`${row.family}::${row.name}`, row]));

function getSectionPropertyProvenance(section, property) {
  const row = bySection.get(`${section?.family || ''}::${section?.name || ''}`);
  if (!row) return null;
  const status = row[`${property}__status`] || null;
  return {
    property,
    status,
    sourceField: row[`${property}__source_field`] || null,
    derivation: row[`${property}__derivation`] || null,
    sourceName: row.source_name || null,
    sourceEdition: row.source_edition || null,
    sourceReference: row.source_ref || null,
    verifiedSource: row.source_verified === true,
    isDerived: status === 'derived_from_same_source_geometry'
  };
}

function getSectionBiaxialProvenance(section) {
  return {
    Wel_z_mm3: getSectionPropertyProvenance(section, 'Wel_z_mm3'),
    Wpl_z_mm3: getSectionPropertyProvenance(section, 'Wpl_z_mm3'),
    Weff_z_mm3: getSectionPropertyProvenance(section, 'Weff_z_mm3'),
    Avy_mm2: getSectionPropertyProvenance(section, 'Avy_mm2')
  };
}

module.exports = { getSectionPropertyProvenance, getSectionBiaxialProvenance };
