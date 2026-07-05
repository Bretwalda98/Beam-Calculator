const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const secureApp = fs.readFileSync(path.join(root, 'public', 'secure-app.js'), 'utf8');

const requiredControlIds = [
  'customUlsG',
  'customUlsQ1',
  'customUlsQ2',
  'customSlsG',
  'customSlsQ1',
  'customSlsQ2',
  'perCheckEnvelope',
  'customCombinationFormula',
  'colbeamSupportMappingLabel',
  'supportEquivalenceNote',
  'springEquivalenceNote',
  'slsDeflectionBasis',
  'slsIncludeSelfWeight',
  'materialVariantLabel',
  'colbeamNationalAnnexLabel',
  'coefficientSource',
  'autoSectionClassificationStatus',
  'class4EffectivePropertiesMode',
  'shearFactorEta',
  'class12ElasticDesign',
  'conservativeNMyMz',
  'flangeBucklingIgnored',
  'webBucklingIgnored',
  'axialSignConvention',
  'ltbC1',
  'ltbC2',
  'ltbC3',
  'ltbKw',
  'colbeamLtbLoadHeight',
  'ltbShearCentreConvention',
  'ltbRestraintModel',
  'ltbMomentGradientMethod',
  'lambdaLT0',
  'ltbBeta',
  'memberBucklingInteractionMethod',
  'colbeamInteractionMethodLabel',
  'supportBearingModel',
  'webBearingModel',
  'stiffenerModel',
  'modalAnalysisStatus'
];

const markupOnlyIds = ['colbeamAuditPanel'];
const outputControlIds = ['colbeamAuditOutput', 'copyColbeamAuditJson', 'downloadColbeamAuditJson'];

requiredControlIds.forEach((id) => {
  assert.ok(indexHtml.includes(`id="${id}"`), `index.html should include #${id}`);
  assert.ok(secureApp.includes(`'${id}'`) || secureApp.includes(`"${id}"`), `secure-app.js should read/write #${id}`);
});
markupOnlyIds.forEach((id) => {
  assert.ok(indexHtml.includes(`id="${id}"`), `index.html should include #${id}`);
});
outputControlIds.forEach((id) => {
  assert.ok(indexHtml.includes(`id="${id}"`), `index.html should include #${id}`);
  assert.ok(secureApp.includes(`'${id}'`) || secureApp.includes(`"${id}"`), `secure-app.js should read/write #${id}`);
});

assert.ok(secureApp.includes('data-field="direction"'), 'Load cards should render direction selectors.');
assert.ok(secureApp.includes('function loadDirection'), 'secure-app.js should collect load direction selectors.');
assert.ok(indexHtml.includes('Recorded for COLBEAM comparison; not yet used by calculation engine.'), 'Metadata-only warning should be visible.');
assert.ok(indexHtml.includes('Current engine uses simplified interaction; COLBEAM Method 1/2 recorded for comparison.'), 'Simplified interaction warning should be visible.');
assert.ok(indexHtml.includes('COLBEAM Audit Output'), 'COLBEAM audit output panel should be visible.');
assert.ok(secureApp.includes('function buildColbeamAuditPayload'), 'secure-app.js should build COLBEAM audit payload.');
assert.ok(secureApp.includes('function renderColbeamAudit'), 'secure-app.js should render COLBEAM audit output.');
assert.ok(secureApp.includes('colbeam-audit-output.json'), 'secure-app.js should support audit JSON download.');

console.log('colbeam ui controls ok', {
  controls: requiredControlIds.length
});
