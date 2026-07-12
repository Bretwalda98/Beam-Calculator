const SUPPORTED_SUPPORTS = new Set(['ss', 'cantilever', 'fixed_fixed', 'fixed_roller', 'spring_spring', 'spring_roller']);
const SUPPORTED_UNITS = new Set(['tonne', 'kn']);
const SUPPORTED_MATERIALS = new Set(['S235', 'S275', 'S355']);
const { LOAD_DIRECTIONS, normaliseColbeamAuditInput } = require('./colbeam-audit-settings');
const { END_FORCE_KEYS, normaliseAnalysisInputMode } = require('./direct-action-service');
const { normaliseSectionDefinition, resolveSpecialSectionDefinition } = require('./special-section-service');

function fail(message, code = 'validation_error') {
  const err = new Error(message);
  err.statusCode = 400;
  err.code = code;
  throw err;
}

function finite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) fail(`${name} must be a valid number.`);
  return n;
}

function optionalFinite(value, fallback, name) {
  if (value === undefined || value === null || value === '') return fallback;
  return finite(value, name);
}

function assertRange(value, min, max, name) {
  const n = finite(value, name);
  if (n < min || n > max) fail(`${name} must be between ${min} and ${max}.`);
  return n;
}

function validateLoadPosition(value, L, name) {
  return assertRange(value, 0, L, name);
}

function validateCalculationRequest(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Calculation request must be a JSON object.');
  const section = input.section || {};
  const sectionDefinition = normaliseSectionDefinition(input);
  if (sectionDefinition.source === 'catalogue' && (!section.family || !section.name)) fail('Select a valid library section.');
  if (sectionDefinition.source === 'stiff_plate' || sectionDefinition.source === 'welded') {
    resolveSpecialSectionDefinition(sectionDefinition);
    if (sectionDefinition.settings?.maximumOneFlangePct !== undefined) assertRange(sectionDefinition.settings.maximumOneFlangePct, 50, 90, 'Maximum loading on one flange');
    if (sectionDefinition.settings?.weldSize_mm !== undefined && sectionDefinition.settings.weldSize_mm !== null && sectionDefinition.settings.weldSize_mm !== '') {
      assertRange(sectionDefinition.settings.weldSize_mm, 0, 200, 'Weld size');
    }
  }
  const L = assertRange(input.model?.span, 0.01, 200, 'Beam span');
  const support = input.model?.supportType || 'ss';
  if (!SUPPORTED_SUPPORTS.has(support)) fail('Unsupported support condition.');
  const units = input.units || 'tonne';
  if (!SUPPORTED_UNITS.has(units)) fail('Unsupported load unit system.');
  const grade = input.material?.grade || 'S355';
  if (!SUPPORTED_MATERIALS.has(grade)) fail('Unsupported steel grade.');
  const analysisInputMode = normaliseAnalysisInputMode(input.analysisInputMode);
  if (analysisInputMode === 'endForces') {
    if (input.model?.analysisMode === 'multi' || support === 'multi_continuous') {
      fail('Member end forces are available for single-member, single-span analysis only.');
    }
    END_FORCE_KEYS.forEach((key) => optionalFinite(input.endForces?.[key], 0, `End force ${key}`));
  }

  const settings = input.settings || {};
  assertRange(settings.gammaM0 ?? 1, 0.5, 2, 'gammaM0');
  assertRange(settings.gammaM1 ?? 1, 0.5, 2, 'gammaM1');
  assertRange(settings.deflectionLimit ?? 300, 50, 1000, 'Deflection limit');
  assertRange(settings.sectionClass ?? 2, 1, 4, 'Section class');
  const audit = normaliseColbeamAuditInput(input);
  assertRange(audit.combination.customULSFactors.G, 0, 3, 'Custom ULS G factor');
  assertRange(audit.combination.customULSFactors.Q1, 0, 3, 'Custom ULS Q1 factor');
  assertRange(audit.combination.customULSFactors.Q2, 0, 3, 'Custom ULS Q2 factor');
  assertRange(audit.combination.customSLSFactors.G, 0, 3, 'Custom SLS G factor');
  assertRange(audit.combination.customSLSFactors.Q1, 0, 3, 'Custom SLS Q1 factor');
  assertRange(audit.combination.customSLSFactors.Q2, 0, 3, 'Custom SLS Q2 factor');
  assertRange(audit.settings.shearFactorEta, 0.1, 2, 'Shear factor eta');
  assertRange(audit.settings.ltbC3, -10, 10, 'LTB C3');
  assertRange(audit.settings.ltbKw, 0.1, 5, 'LTB kw');
  assertRange(audit.settings.lambdaLT0, 0, 2, 'lambdaLT0');
  assertRange(audit.settings.beta, 0.1, 2, 'beta');

  const checkLoadCaseValues = (load, prefix) => {
    ['G', 'Q1', 'Q2'].forEach((key) => optionalFinite(load[key], 0, `${prefix} ${key}`));
  };

  (input.loads?.udls || []).forEach((load, index) => {
    const prefix = `Uniform load ${index + 1}`;
    if (load.direction && !LOAD_DIRECTIONS.has(String(load.direction).toUpperCase())) fail(`${prefix} direction must be Y or Z.`);
    const x1 = validateLoadPosition(load.x1 ?? 0, L, `${prefix} x1`);
    const x2 = validateLoadPosition(load.x2 ?? L, L, `${prefix} x2`);
    if (x2 <= x1) fail(`${prefix} x2 must be greater than x1.`);
    checkLoadCaseValues(load, prefix);
  });

  (input.loads?.points || []).forEach((load, index) => {
    const prefix = Math.abs(Number(load.M || 0)) > 0 ? `Moment load ${index + 1}` : `Point load ${index + 1}`;
    if (load.direction && !LOAD_DIRECTIONS.has(String(load.direction).toUpperCase())) fail(`${prefix} direction must be Y or Z.`);
    validateLoadPosition(load.x ?? 0, L, `${prefix} x`);
    optionalFinite(load.M, 0, `${prefix} M`);
    if (load.momentCase && !['G', 'Q1', 'Q2'].includes(load.momentCase)) fail(`${prefix} moment case must be G, Q1 or Q2.`);
    checkLoadCaseValues(load, prefix);
  });

  if (input.loads?.trapezoidal?.length) {
    fail('Trapezoidal loads must be converted to equivalent backend UDL segments before calculation.');
  }

  const axial = input.axial || {};
  ['G', 'Q1', 'Q2'].forEach((key) => optionalFinite(axial[key], 0, `Axial ${key}`));
  (axial.rows || []).forEach((row, index) => {
    const prefix = `Axial force ${index + 1}`;
    if (row.loadCase && !['G', 'Q1', 'Q2'].includes(String(row.loadCase).toUpperCase())) fail(`${prefix} load case must be G, Q1 or Q2.`);
    if (row.forceType && !['compression', 'tension'].includes(String(row.forceType).toLowerCase())) fail(`${prefix} type must be compression or tension.`);
    optionalFinite(row.value ?? row.signedValue, 0, `${prefix} value`);
  });
  return true;
}

module.exports = { validateCalculationRequest };
