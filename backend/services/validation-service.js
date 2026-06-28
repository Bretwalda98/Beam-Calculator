const SUPPORTED_SUPPORTS = new Set(['ss', 'cantilever', 'fixed_fixed', 'fixed_roller', 'spring_spring', 'spring_roller']);
const SUPPORTED_UNITS = new Set(['tonne', 'kn']);
const SUPPORTED_MATERIALS = new Set(['S235', 'S275', 'S355']);

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
  if (!section.family || !section.name) fail('Select a valid library section.');
  const L = assertRange(input.model?.span, 0.01, 200, 'Beam span');
  const support = input.model?.supportType || 'ss';
  if (!SUPPORTED_SUPPORTS.has(support)) fail('Unsupported support condition.');
  const units = input.units || 'tonne';
  if (!SUPPORTED_UNITS.has(units)) fail('Unsupported load unit system.');
  const grade = input.material?.grade || 'S355';
  if (!SUPPORTED_MATERIALS.has(grade)) fail('Unsupported steel grade.');

  const settings = input.settings || {};
  assertRange(settings.gammaM0 ?? 1, 0.5, 2, 'gammaM0');
  assertRange(settings.gammaM1 ?? 1, 0.5, 2, 'gammaM1');
  assertRange(settings.deflectionLimit ?? 300, 50, 1000, 'Deflection limit');
  assertRange(settings.sectionClass ?? 2, 1, 4, 'Section class');

  const checkLoadCaseValues = (load, prefix) => {
    ['G', 'Q1', 'Q2'].forEach((key) => optionalFinite(load[key], 0, `${prefix} ${key}`));
  };

  (input.loads?.udls || []).forEach((load, index) => {
    const prefix = `Uniform load ${index + 1}`;
    const x1 = validateLoadPosition(load.x1 ?? 0, L, `${prefix} x1`);
    const x2 = validateLoadPosition(load.x2 ?? L, L, `${prefix} x2`);
    if (x2 <= x1) fail(`${prefix} x2 must be greater than x1.`);
    checkLoadCaseValues(load, prefix);
  });

  (input.loads?.points || []).forEach((load, index) => {
    const prefix = Math.abs(Number(load.M || 0)) > 0 ? `Moment load ${index + 1}` : `Point load ${index + 1}`;
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
  return true;
}

module.exports = { validateCalculationRequest };
