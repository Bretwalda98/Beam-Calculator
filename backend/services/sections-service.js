const { PROFILE_DB } = require('../data/sections-database');

const FAMILY_ORDER = ['UB', 'UC', 'UBP', 'J', 'PFC', 'CH', 'RHS', 'HEA', 'HEB', 'HEM', 'HEAA', 'IPE', 'IPN', 'UPE', 'UPN'];

function sectionId(family, name) {
  return `${String(family || '').toUpperCase()}|${String(name || '')}`;
}

function parseSectionId(id) {
  const [family, ...nameParts] = String(id || '').split('|');
  return { family: family || '', name: nameParts.join('|') };
}

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

function listPublicSections() {
  return familyKeys().flatMap((family) => (PROFILE_DB[family] || []).map((row) => ({
    id: sectionId(family, row.name),
    family,
    designation: row.name,
    mass_kg_m: Number(row.mass_kg_m || 0),
    sourceName: row.ltb_source_name || row.ltb_data_source || 'Source to be confirmed',
    sourceEdition: row.ltb_source_edition || '',
    hasPreviewGeometry: Boolean((row.h_mm || row.d_mm) && (row.b_mm || row.D_mm || row.diameter_mm))
  })));
}

function listSectionNames(family) {
  const rows = PROFILE_DB[String(family || '').toUpperCase()] || [];
  return rows.map((row) => ({
    id: sectionId(family, row.name),
    name: row.name,
    designation: row.name,
    mass_kg_m: Number(row.mass_kg_m || 0),
    sourceName: row.ltb_source_name || row.ltb_data_source || 'Source to be confirmed'
  })).filter((row) => row.name);
}

function getSection(family, name) {
  const key = String(family || '').toUpperCase();
  const rows = PROFILE_DB[key] || [];
  const section = rows.find((row) => row.name === name);
  if (!section) return null;
  return { ...section, family: key };
}

function getSectionById(id) {
  const parsed = parseSectionId(decodeURIComponent(String(id || '')));
  return getSection(parsed.family, parsed.name);
}

function visibleNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstVisibleNumber(values, allowZero = false) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && (n > 0 || (allowZero && n === 0))) return n;
  }
  return null;
}

function areaFromMass(section) {
  const mass = visibleNumber(section?.mass_kg_m);
  return mass ? mass / 7850 * 1_000_000 : null;
}

function buildSectionPreview(section) {
  if (!section) return null;
  const family = String(section.family || '').toUpperCase();
  const isHollow = ['RHS', 'SHS', 'CFRHS'].includes(family);
  const isChannel = ['PFC', 'CH', 'UPE', 'UPN'].includes(family);
  const isCircular = ['CHS', 'PIPE'].includes(family);
  const h = visibleNumber(section.h_mm || section.d_mm || section.depth_mm);
  const b = visibleNumber(section.b_mm || section.width_mm);
  const geometry = {
    type: isCircular ? 'chs' : isHollow ? 'rhs' : isChannel ? 'channel' : 'i',
    family,
    h_mm: h,
    b_mm: b,
    diameter_mm: visibleNumber(section.D_mm || section.diameter_mm),
    tw_mm: visibleNumber(section.tw_mm),
    tf_mm: visibleNumber(section.tf_mm || section.t_mm),
    t_mm: visibleNumber(section.t_mm || section.thickness_mm),
    r_mm: visibleNumber(section.r_mm || section.r1_mm),
    r2_mm: visibleNumber(section.r2_mm),
    centroid: {
      y_mm: visibleNumber(section.cy_mm),
      z_mm: visibleNumber(section.cz_mm)
    }
  };
  const warnings = [];
  if (!geometry.h_mm && !geometry.diameter_mm) warnings.push('Overall section depth/diameter is not available.');
  if (!isCircular && !geometry.b_mm) warnings.push('Overall section width is not available.');
  if (geometry.type === 'i' && (!geometry.tw_mm || !geometry.tf_mm)) warnings.push('tw/tf missing - true I/H profile cannot be drawn.');
  if (['i', 'channel', 'rhs'].includes(geometry.type) && !geometry.r_mm) warnings.push('Radius not available from source data.');
  const area = firstVisibleNumber([section.A_mm2, section.area_mm2]) || areaFromMass(section);
  return {
    id: sectionId(family, section.name),
    designation: section.name,
    family,
    source: getSectionSourceInfo(section),
    geometry,
    visibleProperties: {
      h_mm: geometry.h_mm,
      b_mm: geometry.b_mm,
      tw_mm: geometry.tw_mm,
      tf_mm: geometry.tf_mm,
      t_mm: geometry.t_mm,
      r_mm: geometry.r_mm,
      A_mm2: area,
      Aeff_mm2: firstVisibleNumber([section.Aeff_mm2, section.Aeffmm2, section.Aeff]) || area,
      mass_kg_m: visibleNumber(section.mass_kg_m),
      Iy_mm4: visibleNumber(section.Iy_mm4),
      Iz_mm4: visibleNumber(section.Iz_mm4),
      Wel_y_mm3: visibleNumber(section.Wel_y_mm3),
      Wel_z_mm3: visibleNumber(section.Wel_z_mm3),
      Wpl_y_mm3: visibleNumber(section.Wpl_y_mm3),
      Wpl_z_mm3: visibleNumber(section.Wpl_z_mm3),
      Weff_y_mm3: firstVisibleNumber([section.Weff_y_mm3, section.Weffy_mm3, section.Weff_mm3_y, section.Weff_y]),
      Weff_z_mm3: firstVisibleNumber([section.Weff_z_mm3, section.Weffz_mm3, section.Weff_mm3_z, section.Weff_z]),
      Avz_mm2: visibleNumber(section.Avz_mm2),
      It_mm4: firstVisibleNumber([section.It_mm4, section.Ix_mm4, section.I_t_mm4, section.Ix]),
      Iw_mm6: firstVisibleNumber([section.Iw_mm6, section.I_w_mm6, section.Iw], true)
    },
    geometryWarnings: warnings
  };
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
  sectionId,
  parseSectionId,
  listSectionFamilies,
  listPublicSections,
  listSectionNames,
  getSection,
  getSectionById,
  buildSectionPreview,
  getSectionSourceInfo,
  buildSectionSourceIndex
};
