'use strict';

const bundledData = require('../data/verified-special-sections.json');

const SPECIAL_FAMILIES = Object.freeze(['bulb_flat', 'rolled_angle']);
const EXPECTED_UNITS = Object.freeze({
  length: 'mm',
  area: 'mm2',
  sectionModulus: 'mm3',
  inertia: 'mm4',
  warping: 'mm6',
  mass: 'kg/m'
});
const REQUIRED_PROPERTY_KEYS = Object.freeze([
  'A_mm2', 'mass_kg_m', 'Iy_mm4', 'Iz_mm4',
  'Wel_y_top_mm3', 'Wel_y_bottom_mm3', 'Wel_z_left_mm3', 'Wel_z_right_mm3'
]);

function dataError(message, code = 'invalid_special_section_data') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  return error;
}

function positive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function finiteOrNull(value) {
  return value === null || value === undefined || Number.isFinite(Number(value));
}

function validateRecord(record, index = 0) {
  const prefix = `Special-section record ${index + 1}`;
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw dataError(`${prefix} must be an object.`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/.test(String(record.id || ''))) throw dataError(`${prefix} has an invalid id.`);
  if (!SPECIAL_FAMILIES.includes(record.family)) throw dataError(`${prefix} has unsupported family ${record.family || '(missing)'}.`);
  if (!String(record.designation || '').trim()) throw dataError(`${prefix} requires a designation.`);
  if (record.verified !== true) throw dataError(`${prefix} is not verified.`, 'unverified_special_section_data');
  if (!record.source || !String(record.source.name || '').trim() || !String(record.source.reference || '').trim() || !String(record.source.revisionDate || '').trim()) {
    throw dataError(`${prefix} requires source name, reference and revision/date.`);
  }
  Object.entries(EXPECTED_UNITS).forEach(([key, expected]) => {
    if (record.units?.[key] !== expected) throw dataError(`${prefix} unit ${key} must be ${expected}.`, 'invalid_special_section_units');
  });
  if (!record.dimensions || typeof record.dimensions !== 'object' || !Object.keys(record.dimensions).length) throw dataError(`${prefix} requires explicit dimensions.`);
  Object.entries(record.dimensions).forEach(([key, value]) => {
    if (!positive(value)) throw dataError(`${prefix} dimension ${key} must be greater than zero.`);
  });
  if (!record.properties || typeof record.properties !== 'object') throw dataError(`${prefix} requires a properties object.`);
  REQUIRED_PROPERTY_KEYS.forEach((key) => {
    if (!positive(record.properties[key])) throw dataError(`${prefix} requires verified positive property ${key}.`);
  });
  ['Wpl_y_mm3', 'Wpl_z_mm3', 'Avy_mm2', 'Avz_mm2', 'It_mm4', 'Iw_mm6'].forEach((key) => {
    if (!finiteOrNull(record.properties[key]) || Number(record.properties[key]) < 0) throw dataError(`${prefix} property ${key} must be null or a non-negative number.`);
  });
  ['centroid_y_mm', 'centroid_z_mm', 'shear_centre_y_mm', 'shear_centre_z_mm'].forEach((key) => {
    if (!finiteOrNull(record.properties[key])) throw dataError(`${prefix} property ${key} must be null or finite.`);
  });
  return Object.freeze({
    ...record,
    id: String(record.id),
    designation: String(record.designation).trim(),
    standard: String(record.standard || record.source.name).trim(),
    qualityNotes: Array.isArray(record.qualityNotes) ? record.qualityNotes.map(String) : []
  });
}

function createSpecialSectionAdapter(dataset = bundledData) {
  if (!dataset || Number(dataset.schemaVersion) !== 1 || !Array.isArray(dataset.records)) {
    throw dataError('Special-section dataset must use schemaVersion 1 and contain a records array.');
  }
  const records = dataset.records.map(validateRecord);
  const ids = new Set();
  records.forEach((record) => {
    if (ids.has(record.id)) throw dataError(`Duplicate special-section id ${record.id}.`, 'duplicate_special_section_id');
    ids.add(record.id);
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  return Object.freeze({
    schemaVersion: 1,
    list(family) {
      return records.filter((record) => !family || record.family === family).map((record) => ({
        id: record.id,
        family: record.family,
        designation: record.designation,
        standard: record.standard,
        source: record.source,
        verified: true
      }));
    },
    get(id) {
      return byId.get(String(id || '')) || null;
    },
    require(id, family) {
      const record = byId.get(String(id || ''));
      if (!record || (family && record.family !== family)) {
        throw dataError(`Verified ${family || 'special-section'} record ${id || '(missing)'} is not available.`, 'special_section_data_required');
      }
      return record;
    }
  });
}

const specialSectionAdapter = createSpecialSectionAdapter();

module.exports = {
  SPECIAL_FAMILIES,
  EXPECTED_UNITS,
  REQUIRED_PROPERTY_KEYS,
  validateRecord,
  createSpecialSectionAdapter,
  specialSectionAdapter
};
