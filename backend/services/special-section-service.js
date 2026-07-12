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

module.exports = {
  STIFF_PLATE_SUBTYPES,
  WELDED_SUBTYPES,
  normaliseSectionDefinition,
  resolveSpecialSectionDefinition,
  listSpecialSectionOptions
};
