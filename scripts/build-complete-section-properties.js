#!/usr/bin/env node
/*
  Build a complete section-property data file from the existing verified section database.

  Purpose
  -------
  The source database mixes published section tables but every row already carries its
  own source metadata. This builder keeps the source provenance per row and fills
  the weak-axis/minor-axis fields needed by the Advanced EC3 checks.

  Important provenance rule
  -------------------------
  - Existing numeric fields are preserved and marked as existing_table_value.
  - Filled fields are derived from the same row's verified source geometry/properties
    and are marked as derived_from_same_source_geometry, not as a published-table value.
  - No field is silently invented. The script throws if a required output cannot be
    populated for any section.

  Outputs
  -------
  artifacts/section-properties/complete-section-properties.json
  artifacts/section-properties/complete-section-properties.csv
  artifacts/section-properties/sections-database-complete.generated.js
*/

const fs = require('fs');
const path = require('path');
const { PROFILE_DB } = require('../backend/data/sections-database');

const OUT_DIR = path.join(__dirname, '..', 'artifacts', 'section-properties');
const STEEL_DENSITY_KG_M3 = 7850;

const OPEN_I_FAMILIES = new Set(['IPE', 'IPN', 'HEA', 'HEB', 'HEM', 'HEAA', 'UB', 'UC', 'UBP', 'J']);
const CHANNEL_FAMILIES = new Set(['PFC', 'CH', 'UPE', 'UPN']);
const RECT_HOLLOW_FAMILIES = new Set(['RHS', 'SHS', 'CFRHS', 'CFSHS']);
const CIRC_HOLLOW_FAMILIES = new Set(['CHS', 'PIPE']);

const REQUIRED_CANONICAL_FIELDS = [
  'h_mm',
  'b_mm',
  'A_mm2',
  'Aeff_mm2',
  'Iy_mm4',
  'Iz_mm4',
  'Wel_y_mm3',
  'Wpl_y_mm3',
  'Weff_y_mm3',
  'Wel_z_mm3',
  'Wpl_z_mm3',
  'Weff_z_mm3',
  'Avz_mm2',
  'Avy_mm2',
  'It_mm4',
  'Iw_mm6'
];

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveNumber(value) {
  const n = finiteNumber(value);
  return n !== null && n > 0 ? n : null;
}

function round(value, dp = 6) {
  return Number.isFinite(value) ? Number(value.toFixed(dp)) : null;
}

function firstNumber(row, keys, allowZero = false) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      const n = finiteNumber(row[key]);
      if (n !== null && (n > 0 || (allowZero && n === 0))) return { value: n, key };
    }
  }
  return { value: null, key: null };
}

function sourceStamp(row) {
  return {
    source_name: row.ltb_source_name || row.ltb_data_source || row.geometry_source_name || 'Source to be confirmed',
    source_edition: row.ltb_source_edition || row.geometry_source_edition || '',
    source_ref: row.ltb_data_source_ref || row.geometry_source_ref || '',
    source_units: row.ltb_source_units || '',
    source_status: row.ltb_data_status || row.geometry_data_status || row.section_data_status || '',
    source_verified: row.ltb_data_verified === true || row.geometry_data_verified === true
  };
}

function withSource(value, existing, derivedMethod, derivationBasis) {
  if (existing.key) {
    return {
      value: round(existing.value, 6),
      field_source: existing.key,
      field_status: 'existing_table_value',
      derivation: ''
    };
  }
  return {
    value: round(value, 6),
    field_source: 'same_row_verified_source_geometry',
    field_status: 'derived_from_same_source_geometry',
    derivation: derivedMethod,
    derivation_basis: derivationBasis
  };
}

function sectionKind(family) {
  if (OPEN_I_FAMILIES.has(family)) return 'open_i_or_h';
  if (CHANNEL_FAMILIES.has(family)) return 'channel';
  if (RECT_HOLLOW_FAMILIES.has(family)) return 'rectangular_hollow';
  if (CIRC_HOLLOW_FAMILIES.has(family)) return 'circular_hollow';
  return 'unknown';
}

function derivedArea(row) {
  const existing = firstNumber(row, ['A_mm2', 'area_mm2', 'A']);
  if (existing.value !== null) return withSource(existing.value, existing, '', '');
  const mass = positiveNumber(row.mass_kg_m);
  if (!mass) return withSource(null, { value: null, key: null }, '', '');
  return withSource(mass / STEEL_DENSITY_KG_M3 * 1_000_000, { value: null, key: null }, 'A = mass_kg_m / 7850 * 1e6', 'mass_kg_m');
}

function deriveWelZ(row, family, existing, canonical) {
  if (existing.value !== null) return withSource(existing.value, existing, '', '');
  const Iz = positiveNumber(canonical.Iz_mm4?.value);
  const b = positiveNumber(canonical.b_mm?.value);
  if (Iz && b) return withSource(Iz / (b / 2), existing, 'Wel,z = Iz / (b / 2)', 'Iz_mm4 + b_mm');
  return withSource(null, existing, '', '');
}

function deriveWplZ(row, family, existing, canonical) {
  if (existing.value !== null) return withSource(existing.value, existing, '', '');
  const kind = sectionKind(family);
  const h = positiveNumber(canonical.h_mm?.value);
  const b = positiveNumber(canonical.b_mm?.value);
  const tw = positiveNumber(canonical.tw_mm?.value);
  const tf = positiveNumber(canonical.tf_mm?.value);
  const t = positiveNumber(canonical.t_mm?.value || canonical.tf_mm?.value);
  if ((kind === 'open_i_or_h' || kind === 'channel') && h && b && tw && tf) {
    const hw = Math.max(0, h - 2 * tf);
    return withSource((b * b * tf) / 2 + (tw * tw * hw) / 4, existing, 'Wpl,z = b^2*tf/2 + tw^2*(h - 2tf)/4', 'h_mm + b_mm + tw_mm + tf_mm');
  }
  if (kind === 'rectangular_hollow' && h && b && t) {
    const hi = Math.max(0, h - 2 * t);
    const bi = Math.max(0, b - 2 * t);
    return withSource((h * b * b - hi * bi * bi) / 4, existing, 'Wpl,z = (h*b^2 - (h - 2t)*(b - 2t)^2)/4', 'h_mm + b_mm + t_mm');
  }
  if (kind === 'circular_hollow') {
    const D = positiveNumber(canonical.D_mm?.value || canonical.h_mm?.value);
    const th = positiveNumber(canonical.t_mm?.value);
    if (D && th) {
      const d = Math.max(0, D - 2 * th);
      return withSource((D ** 3 - d ** 3) / 6, existing, 'Wpl,z = (D^3 - d^3)/6', 'D_mm + t_mm');
    }
  }
  return withSource(null, existing, '', '');
}

function deriveWeffZ(row, family, existing, canonical) {
  if (existing.value !== null) return withSource(existing.value, existing, '', '');
  const Welz = positiveNumber(canonical.Wel_z_mm3?.value);
  if (Welz) return withSource(Welz, existing, 'Weff,z = Wel,z when no effective weak-axis value is tabulated', 'Wel_z_mm3');
  return withSource(null, existing, '', '');
}

function deriveWeffY(row, existing, canonical) {
  if (existing.value !== null) return withSource(existing.value, existing, '', '');
  const Wely = positiveNumber(canonical.Wel_y_mm3?.value);
  if (Wely) return withSource(Wely, existing, 'Weff,y = Wel,y when no effective strong-axis value is tabulated', 'Wel_y_mm3');
  return withSource(null, existing, '', '');
}

function deriveAvy(row, family, existing, canonical) {
  if (existing.value !== null) return withSource(existing.value, existing, '', '');
  const kind = sectionKind(family);
  const A = positiveNumber(canonical.A_mm2?.value);
  const h = positiveNumber(canonical.h_mm?.value);
  const tw = positiveNumber(canonical.tw_mm?.value);
  const tf = positiveNumber(canonical.tf_mm?.value);
  if ((kind === 'open_i_or_h' || kind === 'channel') && A && h && tw && tf) {
    const hw = Math.max(0, h - 2 * tf);
    return withSource(Math.max(0, A - tw * hw), existing, 'Av,y = A - tw*(h - 2tf)', 'A_mm2 + h_mm + tw_mm + tf_mm');
  }
  if (kind === 'rectangular_hollow' && A) {
    return withSource(A / 2, existing, 'Av,y = A/2 for closed rectangular/square hollow sections', 'A_mm2');
  }
  if (kind === 'circular_hollow' && A) {
    return withSource((2 * A) / Math.PI, existing, 'Av,y = 2A/pi for circular hollow sections', 'A_mm2');
  }
  return withSource(null, existing, '', '');
}

function directField(row, keys, canonicalName, allowZero = false) {
  const existing = firstNumber(row, keys, allowZero);
  return withSource(existing.value, existing, '', '');
}

function completeSection(family, row) {
  const canonical = {};
  canonical.family = { value: family, field_status: 'identifier' };
  canonical.name = { value: row.name, field_status: 'identifier' };
  canonical.kind = { value: sectionKind(family), field_status: 'derived_family_classification' };

  canonical.h_mm = directField(row, ['h_mm', 'd_mm', 'depth_mm', 'D_mm', 'diameter_mm'], 'h_mm');
  canonical.b_mm = directField(row, ['b_mm', 'width_mm', 'D_mm', 'diameter_mm'], 'b_mm');
  canonical.D_mm = directField(row, ['D_mm', 'diameter_mm'], 'D_mm');
  canonical.tw_mm = directField(row, ['tw_mm'], 'tw_mm');
  canonical.tf_mm = directField(row, ['tf_mm', 't_mm'], 'tf_mm');
  canonical.t_mm = directField(row, ['t_mm', 'tf_mm'], 't_mm');
  canonical.r_mm = directField(row, ['r_mm', 'r1_mm'], 'r_mm');
  canonical.r2_mm = directField(row, ['r2_mm'], 'r2_mm');

  canonical.mass_kg_m = directField(row, ['mass_kg_m'], 'mass_kg_m');
  canonical.A_mm2 = derivedArea(row);
  canonical.Aeff_mm2 = directField(row, ['Aeff_mm2', 'Aeffmm2', 'Aeff'], 'Aeff_mm2');
  if (canonical.Aeff_mm2.value === null && canonical.A_mm2.value !== null) {
    canonical.Aeff_mm2 = withSource(canonical.A_mm2.value, { value: null, key: null }, 'Aeff = A when no effective area is tabulated', 'A_mm2');
  }

  canonical.Iy_mm4 = directField(row, ['Iy_mm4', 'Iyy_mm4', 'I_y_mm4'], 'Iy_mm4');
  canonical.Iz_mm4 = directField(row, ['Iz_mm4', 'Izz_mm4', 'I_z_mm4', 'Iminor_mm4'], 'Iz_mm4');
  canonical.Ix_mm4 = directField(row, ['Ix_mm4'], 'Ix_mm4');
  canonical.It_mm4 = directField(row, ['It_mm4', 'Ix_mm4', 'I_t_mm4', 'Ix'], 'It_mm4');
  canonical.Iw_mm6 = directField(row, ['Iw_mm6', 'I_w_mm6', 'Iw'], 'Iw_mm6', true);

  canonical.Wel_y_mm3 = directField(row, ['Wel_y_mm3', 'Wely_mm3', 'Wel_mm3_y', 'Wel_y'], 'Wel_y_mm3');
  canonical.Wpl_y_mm3 = directField(row, ['Wpl_y_mm3', 'Wply_mm3', 'Wpl_mm3_y', 'Wpl_y'], 'Wpl_y_mm3');
  canonical.Weff_y_mm3 = deriveWeffY(row, firstNumber(row, ['Weff_y_mm3', 'Weffy_mm3', 'Weff_mm3_y', 'Weff_y']), canonical);

  canonical.Wel_z_mm3 = deriveWelZ(row, family, firstNumber(row, ['Wel_z_mm3', 'Welz_mm3', 'Wel_mm3_z', 'Wel_z']), canonical);
  canonical.Wpl_z_mm3 = deriveWplZ(row, family, firstNumber(row, ['Wpl_z_mm3', 'Wplz_mm3', 'Wpl_mm3_z', 'Wpl_z']), canonical);
  canonical.Weff_z_mm3 = deriveWeffZ(row, family, firstNumber(row, ['Weff_z_mm3', 'Weffz_mm3', 'Weff_mm3_z', 'Weff_z']), canonical);

  canonical.Avz_mm2 = directField(row, ['Avz_mm2', 'Av_z_mm2', 'Avz', 'Azv_mm2'], 'Avz_mm2');
  canonical.Avy_mm2 = deriveAvy(row, family, firstNumber(row, ['Avy_mm2', 'Av_y_mm2', 'Avy', 'Ayv_mm2']), canonical);

  const sources = sourceStamp(row);
  const output = {
    family,
    name: row.name,
    source_name: sources.source_name,
    source_edition: sources.source_edition,
    source_ref: sources.source_ref,
    source_units: sources.source_units,
    source_status: sources.source_status,
    source_verified: sources.source_verified
  };

  for (const [key, item] of Object.entries(canonical)) {
    if (['family', 'name', 'kind'].includes(key)) continue;
    output[key] = item.value;
    output[`${key}__status`] = item.field_status || '';
    output[`${key}__source_field`] = item.field_source || '';
    output[`${key}__derivation`] = item.derivation || '';
  }
  output.kind = canonical.kind.value;
  output.original_row = row;
  return output;
}

function toFlatCsvRows(rows) {
  const ordered = [
    'family', 'name', 'kind', 'source_name', 'source_edition', 'source_ref', 'source_status', 'source_verified',
    'h_mm', 'b_mm', 'tw_mm', 'tf_mm', 't_mm', 'r_mm', 'r2_mm', 'mass_kg_m', 'A_mm2', 'Aeff_mm2',
    'Iy_mm4', 'Iz_mm4', 'Ix_mm4', 'It_mm4', 'Iw_mm6',
    'Wel_y_mm3', 'Wpl_y_mm3', 'Weff_y_mm3', 'Wel_z_mm3', 'Wpl_z_mm3', 'Weff_z_mm3', 'Avz_mm2', 'Avy_mm2'
  ];
  const statusCols = ordered
    .filter((key) => !['family', 'name', 'kind', 'source_name', 'source_edition', 'source_ref', 'source_status', 'source_verified'].includes(key))
    .flatMap((key) => [`${key}__status`, `${key}__source_field`, `${key}__derivation`]);
  const headers = [...ordered, ...statusCols];
  return { headers, rows: rows.map((row) => headers.map((header) => row[header] ?? '')) };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function validateRows(rows) {
  const errors = [];
  for (const row of rows) {
    for (const key of REQUIRED_CANONICAL_FIELDS) {
      const value = row[key];
      if (!(Number.isFinite(Number(value)) && (Number(value) > 0 || key === 'Iw_mm6'))) {
        errors.push(`${row.family} ${row.name}: ${key} is missing or non-positive`);
      }
    }
  }
  return errors;
}

function buildCompleteDatabase(rows) {
  const byFamily = {};
  for (const row of rows) {
    if (!byFamily[row.family]) byFamily[row.family] = [];
    const completed = { ...row.original_row };
    for (const key of REQUIRED_CANONICAL_FIELDS) completed[key] = row[key];
    completed.minor_axis_completion_status = 'complete_from_existing_or_same_source_geometry_derivation';
    completed.minor_axis_completion_note = 'Existing published values preserved. Missing values filled from the same row source geometry/properties; per-field provenance is stored in generated audit outputs.';
    byFamily[row.family].push(completed);
  }
  return byFamily;
}

function main() {
  const rows = [];
  for (const [family, sections] of Object.entries(PROFILE_DB || {})) {
    for (const row of sections || []) rows.push(completeSection(family, row));
  }
  const errors = validateRows(rows);
  if (errors.length) {
    console.error(`Cannot produce complete no-missing dataset. ${errors.length} missing/invalid values remain.`);
    errors.slice(0, 80).forEach((err) => console.error(`- ${err}`));
    if (errors.length > 80) console.error(`... ${errors.length - 80} more`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fullJsonPath = path.join(OUT_DIR, 'complete-section-properties.json');
  const csvPath = path.join(OUT_DIR, 'complete-section-properties.csv');
  const jsPath = path.join(OUT_DIR, 'sections-database-complete.generated.js');

  fs.writeFileSync(fullJsonPath, JSON.stringify(rows.map(({ original_row, ...row }) => row), null, 2));

  const csv = toFlatCsvRows(rows);
  fs.writeFileSync(csvPath, [csv.headers.join(','), ...csv.rows.map((row) => row.map(csvEscape).join(','))].join('\n'));

  const completeDb = buildCompleteDatabase(rows);
  fs.writeFileSync(
    jsPath,
    `// Generated by scripts/build-complete-section-properties.js\n// Do not edit by hand.\nconst COMPLETE_PROFILE_DB = ${JSON.stringify(completeDb, null, 2)};\n\nmodule.exports = { COMPLETE_PROFILE_DB };\n`
  );

  const derivedCount = rows.reduce((sum, row) => sum + REQUIRED_CANONICAL_FIELDS.filter((key) => String(row[`${key}__status`] || '').startsWith('derived')).length, 0);
  console.log(`Complete section property files written to ${path.relative(process.cwd(), OUT_DIR)}`);
  console.log(`Rows: ${rows.length}`);
  console.log(`Derived field count: ${derivedCount}`);
  console.log(`JSON: ${path.relative(process.cwd(), fullJsonPath)}`);
  console.log(`CSV:  ${path.relative(process.cwd(), csvPath)}`);
  console.log(`JS:   ${path.relative(process.cwd(), jsPath)}`);
}

if (require.main === module) main();

module.exports = { completeSection, validateRows, REQUIRED_CANONICAL_FIELDS };
