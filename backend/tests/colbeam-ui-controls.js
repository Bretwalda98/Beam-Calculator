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
  'advancedEc3SupportMappingLabel',
  'supportEquivalenceNote',
  'springEquivalenceNote',
  'slsDeflectionBasis',
  'slsIncludeSelfWeight',
  'materialVariantLabel',
  'advancedEc3NationalAnnexLabel',
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
  'advancedEc3LtbLoadHeight',
  'ltbShearCentreConvention',
  'ltbRestraintModel',
  'ltbMomentGradientMethod',
  'lambdaLT0',
  'ltbBeta',
  'memberBucklingInteractionMethod',
  'advancedEc3InteractionMethodLabel',
  'supportBearingModel',
  'webBearingModel',
  'stiffenerModel',
  'modalAnalysisStatus'
];

const markupOnlyIds = ['advancedEc3AuditPanel'];
const outputControlIds = ['advancedEc3AuditOutput', 'copyAdvancedEc3AuditJson', 'downloadAdvancedEc3AuditJson'];

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
assert.ok(secureApp.includes('function buildAdvancedEc3AuditPayload'), 'secure-app.js should build audit payload.');
assert.ok(secureApp.includes('function renderAdvancedEc3Audit'), 'secure-app.js should render audit output.');
assert.ok(secureApp.includes('function renderAxisOverview'), 'secure-app.js should render major/minor/combined axis overview.');
assert.ok(secureApp.includes('minorAxisOverview'), 'secure-app.js should render the minor-axis overview card.');
assert.ok(secureApp.includes('combinedAxisOverview'), 'secure-app.js should render the combined axis overview card.');
assert.ok(secureApp.includes('yAxisOverview'), 'Audit JSON should include yAxisOverview.');
assert.ok(secureApp.includes('zAxisOverview'), 'Audit JSON should include zAxisOverview.');
assert.ok(secureApp.includes('governingAxisOverview'), 'Audit JSON should include governingAxisOverview.');
assert.ok(secureApp.includes('Resistance basis'), 'Audit output should show a friendly resistance basis label.');
assert.ok(secureApp.includes('MyRd basis'), 'Audit output should show a friendly MyRd basis label.');
assert.ok(secureApp.includes('MzRd basis'), 'Audit output should show a friendly MzRd basis label.');
assert.ok(secureApp.includes('advanced-ec3-audit-output.json'), 'secure-app.js should support audit JSON download.');
assert.ok(!/colbeam/i.test(indexHtml), 'Public index markup must not expose the old reference name.');
assert.ok(!/colbeam/i.test(secureApp), 'Public secure app bundle must not expose the old reference name.');

console.log('advanced ec3 ui controls ok', {
  controls: requiredControlIds.length
});
