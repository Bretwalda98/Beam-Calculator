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
assert.ok(secureApp.includes('data-field="loadCase"'), 'Load cards should render row-level load case selectors.');
assert.ok(secureApp.includes('G permanent'), 'Load-card load case dropdown should visibly include G permanent.');
assert.ok(secureApp.includes('Q1 main variable'), 'Load-card load case dropdown should visibly include Q1 main variable.');
assert.ok(secureApp.includes('Q2 secondary variable'), 'Load-card load case dropdown should visibly include Q2 secondary variable.');
assert.ok(secureApp.includes('function loadDirection'), 'secure-app.js should collect load direction selectors.');
assert.ok(secureApp.includes('function loadCaseForCard'), 'secure-app.js should collect row-level load cases.');
assert.ok(secureApp.includes('function readAxialRows'), 'secure-app.js should collect repeatable axial force rows.');
assert.ok(indexHtml.includes('id="multiAxialRows"'), 'index.html should include the repeatable axial load row host.');
assert.ok(indexHtml.includes('id="addAxialLoadBtn"'), 'index.html should include an add axial force button.');
assert.ok(!indexHtml.includes('multi-load-card single-mode-only" id="axialLoadCard"'), 'Axial force input card must not be hidden by single-mode-only layout rules.');
assert.ok(indexHtml.includes('#axialLoadCard{order:-1}'), 'Axial force input card should appear near the top of the Loads grid.');
assert.ok(!indexHtml.includes('data-loadcase="G"'), 'Global load case tab selector should be removed.');
assert.ok(!indexHtml.includes('Permanent loads (G)'), 'Global G load case tab should not be visible.');
assert.ok(!indexHtml.includes('id="axialG"'), 'Fixed axial G input should be removed.');
assert.ok(!indexHtml.includes('id="axialQ1"'), 'Fixed axial Q1 input should be removed.');
assert.ok(!indexHtml.includes('id="axialQ2"'), 'Fixed axial Q2 input should be removed.');
assert.ok(indexHtml.includes('Recorded for reference comparison; not yet used by calculation engine.'), 'Metadata-only warning should be visible.');
assert.ok(indexHtml.includes('Current engine uses simplified interaction; reference Method 1/2 recorded for comparison.'), 'Simplified interaction warning should be visible.');
assert.ok(indexHtml.includes('Advanced EC3 Audit Output'), 'Advanced EC3 audit output panel should be visible.');
assert.ok(indexHtml.includes('id="axisOverview"'), 'index.html should include the axis overview mount point.');
assert.ok(indexHtml.includes('id="directionGraphWindows"'), 'index.html should include the direction graph window grid.');
assert.ok(!indexHtml.includes('<div class="stage-tabs">'), 'Overview/Shear/Moment/Deflection/Tables tab bar should be removed.');
assert.ok(!indexHtml.includes('data-tab="stageShear"'), 'Shear tab button should be removed.');
assert.ok(!indexHtml.includes('data-tab="stageMoment"'), 'Moment tab button should be removed.');
assert.ok(!indexHtml.includes('data-tab="stageDeflection"'), 'Deflection tab button should be removed.');
assert.ok(!indexHtml.includes('data-tab="stageTables"'), 'Tables tab button should be removed.');
assert.ok(indexHtml.includes('id="zDirectionGraphWindow"'), 'index.html should include the Z-direction graph window.');
assert.ok(indexHtml.includes('id="yDirectionGraphWindow"'), 'index.html should include the Y-direction graph window.');
['zLoadSketch', 'yLoadSketch', 'chartVz', 'chartMy', 'chartZDefl', 'chartVy', 'chartMz', 'chartYDefl'].forEach((id) => {
  assert.ok(indexHtml.includes(`id="${id}"`), `index.html should include #${id}`);
  assert.ok(secureApp.includes(`'${id}'`) || secureApp.includes(`"${id}"`), `secure-app.js should render #${id}`);
});
assert.ok(indexHtml.includes('Vz(x) [kN] (ULS)'), 'Z-direction shear chart label should be visible.');
assert.ok(indexHtml.includes('My(x) [kN·m] (ULS)'), 'Z-direction moment chart label should be visible.');
assert.ok(indexHtml.includes('z-deflection [mm] (SLS)'), 'Z-direction deflection chart label should be visible.');
assert.ok(indexHtml.includes('Vy(x) [kN] (ULS)'), 'Y-direction shear chart label should be visible.');
assert.ok(indexHtml.includes('Mz(x) [kN·m] (ULS)'), 'Y-direction moment chart label should be visible.');
assert.ok(indexHtml.includes('y-deflection [mm] (SLS)'), 'Y-direction deflection chart label should be visible.');
assert.ok(!indexHtml.includes('Shear Force V(x) [kN] (ULS)'), 'Overview should not expose a generic combined shear chart label.');
assert.ok(!indexHtml.includes('Bending Moment M(x) [kN·m] (ULS)'), 'Overview should not expose a generic combined moment chart label.');
assert.ok(!indexHtml.includes('Deflection y(x) [mm] (SLS)'), 'Overview should not expose a generic combined deflection chart label.');
assert.ok(indexHtml.includes('Force elastic resistance for Class 1-2 sections'), 'Class 1-2 forced-elastic wording should be visible.');
assert.ok(indexHtml.includes('Class 1 has plastic hinge capacity with rotation capacity'), 'EC3 class help text should use Eurocode-consistent wording.');
assert.ok(secureApp.includes('function buildAdvancedEc3AuditPayload'), 'secure-app.js should build audit payload.');
assert.ok(secureApp.includes('function renderAdvancedEc3Audit'), 'secure-app.js should render audit output.');
assert.ok(secureApp.includes('function renderAxisOverview'), 'secure-app.js should render direction/combined overview.');
assert.ok(secureApp.includes('function setDirectionGraphPayloads'), 'secure-app.js should render separate Y/Z direction graph payloads.');
assert.ok(secureApp.includes('zDirectionGraphs'), 'secure-app.js should consume Z-direction backend graph data.');
assert.ok(secureApp.includes('yDirectionGraphs'), 'secure-app.js should consume Y-direction backend graph data.');
assert.ok(secureApp.includes('zDirectionOverview'), 'secure-app.js should render the Z-direction overview card and JSON key.');
assert.ok(secureApp.includes('yDirectionOverview'), 'secure-app.js should render the Y-direction overview card and JSON key.');
assert.ok(secureApp.includes('combinedDirectionOverview'), 'secure-app.js should render the combined overview card.');
assert.ok(secureApp.includes('combinedOverview'), 'Audit JSON should include combinedOverview.');
assert.ok(secureApp.includes('axisConvention'), 'Audit JSON should include axisConvention.');
assert.ok(secureApp.includes('Resistance basis'), 'Audit output should show a friendly resistance basis label.');
assert.ok(secureApp.includes('MyRd basis'), 'Audit output should show a friendly MyRd basis label.');
assert.ok(secureApp.includes('MzRd basis'), 'Audit output should show a friendly MzRd basis label.');
assert.ok(secureApp.includes('advanced-ec3-audit-output.json'), 'secure-app.js should support audit JSON download.');
assert.ok(indexHtml.includes('id="analysisInputMode"'), 'Analysis input mode selector should be visible.');
assert.ok(indexHtml.includes('value="endForces"'), 'Member end-force mode should be selectable.');
['endForceN', 'endForceMy1', 'endForceMy2', 'endForceMz1', 'endForceMz2', 'endForceVz1', 'endForceVz2', 'endForceVy1', 'endForceVy2'].forEach((id) => {
  assert.ok(indexHtml.includes(`id="${id}"`), `End-force panel should include #${id}.`);
});
assert.ok(!indexHtml.match(/endForcesPanel[\s\S]{0,1800}G \/ Q1 \/ Q2/), 'End-force panel must not include G/Q load-case controls.');
assert.ok(secureApp.includes('function readEndForcesFromFields'), 'Frontend should convert end-force display values to base units.');
assert.ok(secureApp.includes("analysisInputMode: getAnalysisInputMode()"), 'Calculation requests should include the analysis input mode.');
assert.ok(secureApp.includes('applyEndForcesToFields(input.endForces || {}'), 'Saved projects should restore end-force fields and migrate old projects safely.');
assert.ok(!/colbeam/i.test(indexHtml), 'Public index markup must not expose the old reference name.');
assert.ok(!/colbeam/i.test(secureApp), 'Public secure app bundle must not expose the old reference name.');

console.log('advanced ec3 ui controls ok', {
  controls: requiredControlIds.length
});
