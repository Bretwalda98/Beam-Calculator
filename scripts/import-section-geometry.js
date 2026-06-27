const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_FILE = path.join(__dirname, 'section-geometry-source-data.json');
const DATABASE_FILES = [
  path.join(ROOT, 'public', 'sections_database.js'),
  path.join(ROOT, 'backend', 'data', 'sections-database.js')
];
const AUDIT_FILE = path.join(ROOT, 'section_geometry_audit.md');

const OPEN_FAMILIES = new Set(['UB', 'UC', 'UBP', 'J', 'PFC', 'CH', 'HEA', 'HEB', 'HEM', 'HEAA', 'IPE', 'IPN', 'UPE', 'UPN']);
const HOLLOW_FAMILIES = new Set(['RHS', 'SHS', 'CHS', 'CFRHS']);
const GEOMETRY_FIELDS = [
  'h_mm',
  'b_mm',
  'tw_mm',
  'tf_mm',
  't_mm',
  'r_mm',
  'r2_mm',
  'D_mm',
  'a_mm',
  'geometry_source_name',
  'geometry_source_edition',
  'geometry_source_ref',
  'geometry_quality_note',
  'geometry_data_status',
  'geometry_data_verified'
];

function normaliseName(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function geometryKey(family, name) {
  return `${String(family || '').toUpperCase()}|${normaliseName(name)}`;
}

function loadProfileDb(file) {
  const text = fs.readFileSync(file, 'utf8');
  const context = { module: { exports: {} }, exports: {}, window: {} };
  vm.createContext(context);
  vm.runInContext(`${text}\nthis.__PROFILE_DB = typeof PROFILE_DB !== 'undefined' ? PROFILE_DB : (module.exports.PROFILE_DB || module.exports);`, context, { filename: file });
  if (!context.__PROFILE_DB || typeof context.__PROFILE_DB !== 'object') {
    throw new Error(`Could not load PROFILE_DB from ${file}`);
  }
  return context.__PROFILE_DB;
}

function writeProfileDb(file, db) {
  const body = `const PROFILE_DB = ${JSON.stringify(db, null, 2)};\n\nif (typeof module !== 'undefined') {\n  module.exports = { PROFILE_DB };\n}\n\nif (typeof window !== 'undefined') {\n  window.PROFILE_DB = PROFILE_DB;\n}\n`;
  fs.writeFileSync(file, body, 'utf8');
}

function hasPositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function requiredFieldsForFamily(family) {
  if (OPEN_FAMILIES.has(family)) return ['h_mm', 'b_mm', 'tw_mm', 'tf_mm', 'r_mm'];
  if (HOLLOW_FAMILIES.has(family)) return ['h_mm', 'b_mm', 't_mm', 'r_mm'];
  return [];
}

function validateDb(db) {
  const missing = [];
  Object.entries(db).forEach(([family, rows]) => {
    (rows || []).forEach((row) => {
      const absent = requiredFieldsForFamily(family).filter((field) => !hasPositive(row[field]));
      if (absent.length) missing.push({ family, name: row.name, missing: absent });
    });
  });
  return missing;
}

function sourceIndex(sourceData) {
  const index = new Map();
  sourceData.rows.forEach((row) => {
    index.set(geometryKey(row.family, row.name), row);
  });
  return index;
}

function applyGeometry(db, sourceData) {
  const index = sourceIndex(sourceData);
  const changes = [];
  const misses = [];

  Object.entries(db).forEach(([family, rows]) => {
    (rows || []).forEach((row) => {
      const src = index.get(geometryKey(family, row.name));
      if (!src) {
        misses.push({ family, name: row.name });
        return;
      }
      GEOMETRY_FIELDS.forEach((field) => {
        if (src[field] !== undefined && row[field] !== src[field]) {
          row[field] = src[field];
          changes.push({ family, name: row.name, field });
        }
      });
    });
  });

  return { changes, misses };
}

function buildAudit(db, sourceData, allChanges) {
  const now = new Date().toISOString().slice(0, 10);
  const rows = Object.entries(db).flatMap(([family, familyRows]) => familyRows.map((row) => ({ family, row })));
  const missing = validateDb(db);
  const byFamily = Object.entries(db).map(([family, familyRows]) => {
    const familyMissing = familyRows.filter((row) => requiredFieldsForFamily(family).some((field) => !hasPositive(row[field])));
    const sourceNames = [...new Set(familyRows.map((row) => row.geometry_source_name || 'Source to be confirmed'))].sort();
    return `| ${family} | ${familyRows.length} | ${familyMissing.length} | ${sourceNames.join('<br>')} |`;
  }).join('\n');
  const sourceRows = sourceData.sources.map((source) => `| ${source.name} | ${source.edition} | ${source.reference} |`).join('\n');
  const changedFieldCount = allChanges.length;
  const changedRows = new Set(allChanges.map((change) => `${change.family}|${change.name}`)).size;

  return `# Section Geometry Source Audit

Audit date: ${now}

## Summary

- Database rows reviewed: ${rows.length}
- Rows carrying required geometry after import: ${rows.length - missing.length}
- Rows missing required geometry after import: ${missing.length}
- Rows changed by latest import: ${changedRows}
- Individual geometry/provenance field changes: ${changedFieldCount}
- Import source table: \`scripts/section-geometry-source-data.json\`

The importer updates geometry only. It does not change engineering formulas, design checks, section moduli, areas, LTB values or material properties.

## Family Results

| Family | Rows | Missing required geometry | Geometry source(s) |
|---|---:|---:|---|
${byFamily}

## Published / Normalised Sources

| Source | Edition | Reference |
|---|---|---|
${sourceRows}

## Required Geometry Rules

- Open rolled and channel sections require \`h_mm\`, \`b_mm\`, \`tw_mm\`, \`tf_mm\` and \`r_mm\`.
- Hollow sections require \`h_mm\`, \`b_mm\`, \`t_mm\` and \`r_mm\`.
- \`r2_mm\` is stored where the published channel source provides a toe radius.
- Rows with missing future geometry must remain visible as warnings in the UI/report renderer; the importer currently leaves zero missing rows.
`;
}

function main() {
  const sourceData = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
  if (sourceData.schema !== 'beam-calculator-section-geometry-source-data-v1') {
    throw new Error(`Unexpected geometry source schema: ${sourceData.schema}`);
  }

  const sourceKeys = new Set(sourceData.rows.map((row) => geometryKey(row.family, row.name)));
  if (sourceKeys.size !== sourceData.rows.length) {
    throw new Error('Duplicate section geometry source rows found.');
  }

  let auditDb = null;
  const allChanges = [];
  DATABASE_FILES.forEach((file) => {
    const db = loadProfileDb(file);
    const { changes, misses } = applyGeometry(db, sourceData);
    if (misses.length) {
      throw new Error(`Missing geometry source rows for ${file}: ${JSON.stringify(misses.slice(0, 20))}`);
    }
    const missingAfterImport = validateDb(db);
    if (missingAfterImport.length) {
      throw new Error(`Required geometry still missing in ${file}: ${JSON.stringify(missingAfterImport.slice(0, 20))}`);
    }
    writeProfileDb(file, db);
    auditDb = db;
    allChanges.push(...changes);
  });

  fs.writeFileSync(AUDIT_FILE, buildAudit(auditDb, sourceData, allChanges), 'utf8');
  console.log(`Section geometry import complete. Field changes: ${allChanges.length}. Audit: ${path.relative(ROOT, AUDIT_FILE)}`);
}

main();
