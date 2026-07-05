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
assert.ok(indexHtml.includes('Recorded for reference comparison; not yet used by calculation engine.'), 'Metadata-only warning should be visible.');
assert.ok(indexHtml.includes('Current engine uses simplified interaction; reference Method 1/2 recorded for comparison.'), 'Simplified interaction warning should be visible.');
assert.ok(indexHtml.includes('Advanced EC3 Audit Output'), 'Advanced EC3 audit output panel should be visible.');
assert.ok(indexHtml.includes('id="axisOverview"'), 'index.html should include the axis overview mount point.');
assert.ok(indexHtml.includes('Force elastic resistance for Class 1-2 sections'), 'Class 1-2 forced-elastic wording should be visible.');
assert.ok(indexHtml.includes('Class 1 has plastic hinge capacity with rotation capacity'), 'EC3 class help text should use Eurocode-consistent wording.');
assert.ok(secureApp.includes('function buildColbeamAuditPayload'), 'secure-app.js should build audit payload.');
assert.ok(secureApp.includes('function renderColbeamAudit'), 'secure-app.js should render audit output.');
assert.ok(secureApp.includes('function renderAxisOverview'), 'secure-app.js should render major/minor/combined axis overview.');
assert.ok(secureApp.includes('minorAxisOverview'), 'secure-app.js should render the minor-axis overview card.');
assert.ok(secureApp.includes('combinedAxisOverview'), 'secure-app.js should render the combined axis overview card.');
assert.ok(secureApp.includes('Resistance basis'), 'Audit output should show a friendly resistance basis label.');
assert.ok(secureApp.includes('MyRd basis'), 'Audit output should show a friendly MyRd basis label.');
assert.ok(secureApp.includes('MzRd basis'), 'Audit output should show a friendly MzRd basis label.');
assert.ok(secureApp.includes('advanced-ec3-audit-output.json'), 'secure-app.js should support audit JSON download.');

console.log('colbeam ui controls ok', {
  controls: requiredControlIds.length
});
