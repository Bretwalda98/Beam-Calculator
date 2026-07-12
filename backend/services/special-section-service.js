'use strict';

const { specialSectionAdapter } = require('./external-special-section-adapter');
const { derivePlateSubtype } = require('./special-section-geometry');

const STIFF_PLATE_SUBTYPES = Object.freeze([
  'plate_flatbar', 'plate_bulb_flat', 'plate_t_girder', 'plate_rolled_l', 'plate_l_welded'
]);
const WELDED_SUBTYPES = Object.freeze([
  'welded_hsq_symmetric', 'welded_hsq_non_symmetric', 'welded_i_single_symmetric', 'welded_i_double_symmetric',
  'welded_box_non_symmetric', 'welded_box_double_symmetric', 'welded_t_axial'
]);
const SUBTYPE_LABELS = Object.freeze({
  plate_flatbar: 'Plate + Flatbar',
  plate_bulb_flat: 'Plate + Bulb Flat',
  plate_t_girder: 'Plate + T-girder',
  plate_rolled_l: 'Plate + rolled L',
  plate_l_welded: 'Plate + L-welded',
  welded_hsq_symmetric: 'HSQ - symmetric flanges',
  welded_hsq_non_symmetric: 'HSQ - non-symmetric flanges',
  welded_i_single_symmetric: 'I - single symmetric',
  welded_i_double_symmetric: 'I - double symmetric',
  welded_box_non_symmetric: 'Box - non-symmetric flanges',
  welded_box_double_symmetric: 'Box - double symmetric',
  welded_t_axial: 'T section - axial loading only'
});

function definitionError(message, code = 'invalid_section_definition') {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

function normaliseSectionDefinition(input = {}) {
  const legacy = input.sectionDefinition;
  if (!legacy) return { source: 'catalogue', family: input.section?.family, recordId: input.section?.name };
  if (!['catalogue', 'stiff_plate', 'welded', 'custom'].includes(legacy.source)) throw definitionError('Unsupported section definition source.');
  return {
    schemaVersion: 1,
    source: legacy.source,
    family: legacy.family || null,
    recordId: legacy.recordId || null,
    subtype: legacy.subtype || null,
    dimensions: legacy.dimensions && typeof legacy.dimensions === 'object' ? { ...legacy.dimensions } : {},
    componentRefs: legacy.componentRefs && typeof legacy.componentRefs === 'object' ? { ...legacy.componentRefs } : {},
    settings: legacy.settings && typeof legacy.settings === 'object' ? { ...legacy.settings } : {}
  };
}

function requiredStatus(message, definition) {
  return { status: 'DATA_REQUIRED', message, definition, properties: null, missingProperties: [message] };
}

function resolveSpecialSectionDefinition(definitionInput) {
  const definition = normaliseSectionDefinition({ sectionDefinition: definitionInput });
  if (definition.source === 'catalogue' || definition.source === 'custom') return null;
  const allowed = definition.source === 'stiff_plate' ? STIFF_PLATE_SUBTYPES : WELDED_SUBTYPES;
  if (!allowed.includes(definition.subtype)) throw definitionError(`Unsupported ${definition.source} subtype.`);
  if (definition.subtype === 'plate_bulb_flat' || definition.subtype === 'plate_rolled_l') {
    const family = definition.subtype === 'plate_bulb_flat' ? 'bulb_flat' : 'rolled_angle';
    const id = definition.componentRefs.profileRecordId;
    const record = id ? specialSectionAdapter.get(id) : null;
    if (!record || record.family !== family) return requiredStatus(`No verified ${family.replace('_', ' ')} section data loaded.`, definition);
    return requiredStatus(`Verified ${family.replace('_', ' ')} component ${record.designation} is loaded, but its composite plate placement rule is not yet verified.`, definition);
  }
  if (definition.subtype.startsWith('welded_hsq_')) {
    return requiredStatus('Authoritative HSQ component layout and dimension mapping are required.', definition);
  }
  try {
    const properties = derivePlateSubtype(definition.subtype, definition.dimensions, { source: 'Explicit user-entered plate geometry' });
    return {
      status: 'GEOMETRY_DERIVED',
      message: 'Gross geometric properties derived from explicit non-overlapping plate components.',
      definition,
      properties,
      missingProperties: Object.entries(properties.unavailable).map(([key, reason]) => `${key}: ${reason}`),
      axialOnly: definition.subtype === 'welded_t_axial'
    };
  } catch (error) {
    if (error.code === 'special_section_data_required') return requiredStatus(error.message, definition);
    throw error;
  }
}

function listSpecialSectionOptions() {
  return {
    schemaVersion: 1,
    stiffPlateSubtypes: STIFF_PLATE_SUBTYPES,
    weldedSubtypes: WELDED_SUBTYPES,
    bulbFlats: specialSectionAdapter.list('bulb_flat'),
    rolledAngles: specialSectionAdapter.list('rolled_angle')
  };
}

function specialResolutionToSection(resolution) {
  if (!resolution || resolution.status !== 'GEOMETRY_DERIVED' || !resolution.properties) {
    throw definitionError(resolution?.message || 'Special-section geometry is not available.', 'special_section_data_required');
  }
  const p = resolution.properties;
  const definition = resolution.definition;
  const label = definition.settings?.name || SUBTYPE_LABELS[definition.subtype] || definition.subtype;
  const d = definition.dimensions || {};
  return {
    name: label,
    family: 'SPECIAL',
    source_type: 'special_geometry',
    section_data_status: 'geometry_derived_incomplete',
    specialSection: true,
    specialSectionStatus: resolution.status,
    specialSectionDefinition: definition,
    specialComponents: p.components,
    specialMissingProperties: resolution.missingProperties,
    axialOnly: resolution.axialOnly,
    A_mm2: p.A_mm2,
    mass_kg_m: p.mass_kg_m,
    Iy_mm4: p.Iy_mm4,
    Iz_mm4: p.Iz_mm4,
    Wel_y_mm3: Math.min(p.Wel_y_top_mm3, p.Wel_y_bottom_mm3),
    Wel_z_mm3: Math.min(p.Wel_z_left_mm3, p.Wel_z_right_mm3),
    Wel_y_top_mm3: p.Wel_y_top_mm3,
    Wel_y_bottom_mm3: p.Wel_y_bottom_mm3,
    Wel_z_left_mm3: p.Wel_z_left_mm3,
    Wel_z_right_mm3: p.Wel_z_right_mm3,
    Wpl_y_mm3: p.Wpl_y_mm3,
    Wpl_z_mm3: p.Wpl_z_mm3,
    exposedPerimeter_mm: p.exposedPerimeter_mm,
    exposedSurface_m2_m: p.exposedSurface_m2_m,
    h_mm: p.bounds.height_mm,
    b_mm: p.bounds.width_mm,
    tw_mm: Number(d.webThickness_mm || d.thickness_mm) || null,
    tf_mm: Number(d.topFlangeThickness_mm || d.flangeThickness_mm || d.thickness_mm) || null,
    centroid_y_mm: p.centroid_y_mm,
    centroid_z_mm: p.centroid_z_mm,
    plasticNeutralAxis_y_mm: p.plasticNeutralAxis_y_mm,
    plasticNeutralAxis_z_mm: p.plasticNeutralAxis_z_mm,
    ltb_data_verified: false,
    ltb_data_status: 'not_available_for_geometry_derived_special_section',
    geometry_source_name: 'Explicit user-entered plate geometry',
    geometry_quality_note: 'Gross properties derived from non-overlapping rectangular plate components. Shear, torsion, warping, shear-centre, effective-section and family classification rules are not estimated.'
  };
}

module.exports = {
  STIFF_PLATE_SUBTYPES,
  WELDED_SUBTYPES,
  normaliseSectionDefinition,
  resolveSpecialSectionDefinition,
  listSpecialSectionOptions,
  specialResolutionToSection,
  SUBTYPE_LABELS
};
