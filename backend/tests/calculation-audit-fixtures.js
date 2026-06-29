const assert = require('assert');
const path = require('path');
const { calculateBeam } = require('../services/calculation-service');

const fixtures = require(path.join(__dirname, 'fixtures', 'calculation-engine-audit-cases.json'));

const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDeep(base, override) {
  if (override == null) return base;
  if (Array.isArray(override) || typeof override !== 'object') return clone(override);
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? clone(base) : {}) };
  Object.entries(override).forEach(([key, value]) => {
    out[key] = mergeDeep(out[key], value);
  });
  return out;
}

function inputFor(fixture) {
  if (!fixture.inherits) return clone(fixture.input);
  const parent = byId.get(fixture.inherits);
  assert.ok(parent, `${fixture.id} inherits missing fixture ${fixture.inherits}`);
  return mergeDeep(inputFor(parent), fixture.overrides || {});
}

function assertApprox(actual, expected, label) {
  assert.strictEqual(typeof actual, 'number', `${label} should be numeric`);
  const tolerance = Math.max(0.0001, Math.abs(expected) * 0.01);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, got ${actual}`
  );
}

function assertExpectedObject(actual, expected, label) {
  Object.entries(expected || {}).forEach(([key, expectedValue]) => {
    if (key === 'messageContains') {
      assert.ok(String(actual?.message || '').includes(expectedValue), `${label}.message should include "${expectedValue}"`);
      return;
    }
    if (typeof expectedValue === 'number') {
      assertApprox(actual?.[key], expectedValue, `${label}.${key}`);
      return;
    }
    if (expectedValue && typeof expectedValue === 'object' && !Array.isArray(expectedValue)) {
      assertExpectedObject(actual?.[key], expectedValue, `${label}.${key}`);
      return;
    }
    assert.deepStrictEqual(actual?.[key], expectedValue, `${label}.${key}`);
  });
}

function runFixture(fixture) {
  const result = calculateBeam(inputFor(fixture));
  const expected = fixture.expected || {};

  if (expected.status) assert.strictEqual(result.status, expected.status, `${fixture.id}.status`);
  if (expected.sectionModulusLabel) {
    assert.strictEqual(result.sectionProperties?.modulusLabel, expected.sectionModulusLabel, `${fixture.id}.sectionProperties.modulusLabel`);
  }
  if (expected.summary) assertExpectedObject(result.summary, expected.summary, `${fixture.id}.summary`);
  if (expected.actions?.ulsNoteContains) {
    assert.ok(result.actions?.ulsNote?.includes(expected.actions.ulsNoteContains), `${fixture.id}.actions.ulsNote should include ${expected.actions.ulsNoteContains}`);
  }
  if (expected.checks) {
    Object.entries(expected.checks).forEach(([checkName, checkExpected]) => {
      assertExpectedObject(result.checks?.[checkName], checkExpected, `${fixture.id}.checks.${checkName}`);
    });
  }
  if (expected.controlHeadings) {
    const headings = (result.codeCheckControls?.sections || []).map((section) => section.heading);
    expected.controlHeadings.forEach((heading) => {
      assert.ok(headings.includes(heading), `${fixture.id}.codeCheckControls should include heading ${heading}`);
    });
  }
  const calculations = result.calculationPackage?.calculations || [];
  assert.ok(calculations.length > 0, `${fixture.id}.calculationPackage.calculations should be populated`);
  const derivationCount = calculations.reduce((sum, calculation) => sum + (calculation.derivations || []).length, 0);
  assert.ok(derivationCount > 0, `${fixture.id}.calculationPackage should include variable derivations`);
  const sampledDeflection = Math.max(...(result.diagrams?.series || []).map((point) => Math.abs(Number(point.deflection || 0))));
  assertApprox(sampledDeflection, result.summary.deflection, `${fixture.id}.diagrams.series deflection peak should match SLS summary deflection`);
  assert.strictEqual(result.diagrams?.basis?.deflection, 'SLS', `${fixture.id}.diagrams.basis.deflection`);

  return {
    id: fixture.id,
    status: result.status,
    governingIR: result.summary.governingIR
  };
}

const summaries = fixtures.map(runFixture);

console.log('calculation audit fixtures ok', summaries);
