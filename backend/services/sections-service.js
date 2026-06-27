const { PROFILE_DB } = require('../data/sections-database');

const FAMILY_ORDER = ['UB', 'UC', 'UBP', 'J', 'PFC', 'CH', 'RHS', 'HEA', 'HEB', 'HEM', 'HEAA', 'IPE', 'IPN', 'UPE', 'UPN'];

function familyKeys() {
  const keys = Object.keys(PROFILE_DB || {});
  return [
    ...FAMILY_ORDER.filter((family) => keys.includes(family)),
    ...keys.filter((family) => !FAMILY_ORDER.includes(family)).sort()
  ];
}

function listSectionFamilies() {
  return familyKeys().map((family) => ({
    family,
    count: Array.isArray(PROFILE_DB[family]) ? PROFILE_DB[family].length : 0
  }));
}

function listSectionNames(family) {
  const rows = PROFILE_DB[String(family || '').toUpperCase()] || [];
  return rows.map((row) => row.name).filter(Boolean);
}

function getSection(family, name) {
  const key = String(family || '').toUpperCase();
  const rows = PROFILE_DB[key] || [];
  const section = rows.find((row) => row.name === name);
  if (!section) return null;
  return { ...section, family: key };
}

function getSectionSourceInfo(section) {
  if (!section) {
    return {
      title: 'Source to be confirmed',
      detail: 'No section row is currently selected.',
      url: 'Source to be confirmed'
    };
  }
  if (section.source_type === 'custom') {
    return {
      title: 'User-defined custom section',
      detail: 'Generated from authenticated user-entered dimensions inside the app.',
      url: 'In-app custom section builder'
    };
  }
  if (section.ltb_source_name) {
    const edition = section.ltb_source_edition ? ` (${section.ltb_source_edition})` : '';
    const status = section.ltb_data_status ? String(section.ltb_data_status).replaceAll('_', ' ') : 'published section data';
    return {
      title: `${section.ltb_source_name}${edition}`,
      detail: `${section.family || 'Section'} properties use ${status}. ${section.ltb_quality_note || section.ltb_source_note || 'Published Iz, It and Iw values are stored in the server database.'}`,
      url: section.ltb_data_source_ref || 'Server section database'
    };
  }
  // TODO: Confirm source metadata for section rows that do not carry ltb_source_name / ltb_data_source.
  return {
    title: 'Source to be confirmed',
    detail: 'This section row is bundled in the server section database but does not currently carry a confirmed source name, standard/catalogue, edition or reference.',
    url: 'Source to be confirmed'
  };
}

function buildSectionSourceIndex() {
  const groups = new Map();
  familyKeys().forEach((family) => {
    (PROFILE_DB[family] || []).forEach((row) => {
      const sourceName = row.ltb_source_name || row.ltb_data_source || 'Source to be confirmed';
      const edition = row.ltb_source_edition || (sourceName === 'Source to be confirmed' ? 'Source to be confirmed' : 'Version/date not stated in row');
      const reference = row.ltb_data_source_ref || (sourceName === 'Source to be confirmed' ? 'Source to be confirmed' : 'Server section database row metadata');
      const key = [sourceName, edition, reference].join('|');
      if (!groups.has(key)) {
        groups.set(key, {
          sourceName,
          standard: sourceName,
          region: inferRegion(sourceName, family),
          edition,
          reference,
          sectionTypes: new Set(),
          assumptions: new Set()
        });
      }
      const group = groups.get(key);
      group.sectionTypes.add(family);
      if (row.ltb_source_units) group.assumptions.add(row.ltb_source_units);
      if (row.ltb_source_note) group.assumptions.add(row.ltb_source_note);
      if (row.ltb_quality_note) group.assumptions.add(row.ltb_quality_note);
      if (row.geometry_source_name) group.assumptions.add(`Geometry source: ${row.geometry_source_name}${row.geometry_source_edition ? ` (${row.geometry_source_edition})` : ''}.`);
      if (row.geometry_quality_note) group.assumptions.add(row.geometry_quality_note);
      if (sourceName === 'Source to be confirmed') group.assumptions.add('Source to be confirmed');
    });
  });
  return Array.from(groups.values()).map((group) => ({
    ...group,
    sectionTypes: Array.from(group.sectionTypes).sort(),
    assumptions: Array.from(group.assumptions).slice(0, 8)
  })).sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}

function inferRegion(sourceName, family) {
  const text = `${sourceName || ''} ${family || ''}`.toLowerCase();
  if (text.includes('british') || text.includes('steel for life') || ['UB', 'UC', 'UBP', 'PFC'].includes(family)) return 'United Kingdom';
  if (text.includes('arcelormittal') || ['IPE', 'HEA', 'HEB', 'HEM', 'HEAA'].includes(family)) return 'Europe';
  return 'Not specified';
}

module.exports = {
  listSectionFamilies,
  listSectionNames,
  getSection,
  getSectionSourceInfo,
  buildSectionSourceIndex
};
