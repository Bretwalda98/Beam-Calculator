import assert from 'node:assert/strict';
import test from 'node:test';
import { createCadFEMProject } from '../cad-fem-schema';
import { validateCadFEMProject } from './index';

test('new CAD/FEM project has supported defaults but is not solve-ready', () => {
  const project = createCadFEMProject('2026-07-16T00:00:00.000Z', 'project-1');
  const report = validateCadFEMProject(project);
  assert.equal(project.schemaVersion, '1.0.0');
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(({ code }) => code === 'study_component_missing'));
  assert.ok(report.errors.some(({ code }) => code === 'study_support_missing'));
  assert.ok(report.errors.some(({ code }) => code === 'study_load_missing'));
});

test('near-incompressible materials are rejected at the declared limit', () => {
  const project = createCadFEMProject('2026-07-16T00:00:00.000Z', 'project-2');
  project.materials[0].poissonRatio = 0.49;
  const report = validateCadFEMProject(project);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(({ code }) => code === 'poisson_ratio_unsupported'));
});

test('frictionless contact cannot run as a linear static study', () => {
  const project = createCadFEMProject('2026-07-16T00:00:00.000Z', 'project-3');
  const ref = {
    documentId: 'document',
    bodyId: 'body',
    featureId: 'feature',
    semanticName: 'Face:contact',
    topologyRevision: 0,
    fallbackSignature: {
      kind: 'face' as const,
      centroid: [0, 0, 0] as [number, number, number],
      measure: 1,
      normal: [0, 0, 1] as [number, number, number],
      adjacentKinds: ['edge']
    }
  };
  project.studies[0].contacts.push({
    id: 'contact',
    name: 'Contact',
    type: 'frictionless',
    primary: [ref],
    secondary: [ref],
    formulation: 'mortar',
    enabled: true
  });
  const report = validateCadFEMProject(project);
  assert.ok(report.errors.some(({ code }) => code === 'contact_requires_nonlinear_study'));
});

test('catalogue extrusion validates its immutable EC3 geometry snapshot', () => {
  const project = createCadFEMProject('2026-07-16T00:00:00.000Z', 'project-4');
  const document = project.partDocuments[0];
  document.geometryRevision = 1;
  project.studies[0].geometryRevision = 1;
  document.features.push({
    id: 'feature-1',
    name: 'UB extrusion',
    type: 'catalogueExtrusion',
    length: 3000,
    operation: 'newBody',
    suppressed: false,
    section: {
      schemaVersion: '1.0.0',
      catalogue: 'beam-ec3',
      catalogueRevision: 'a'.repeat(64),
      sectionId: 'UB|UB 254x146x31',
      designation: 'UB 254x146x31',
      family: 'UB',
      kind: 'i',
      units: 'mm',
      dimensions: {
        height: 251.4,
        width: 146.1,
        webThickness: 6,
        flangeThickness: 8.6,
        wallThickness: null,
        rootRadius: 7.6,
        toeRadius: null,
        flangeSlopePercent: 0,
        innerRadius: null
      },
      properties: { area: 3970, iy: 44130000, iz: 4480000, torsionConstant: 121000, massPerLength: 31.1 },
      source: { title: 'Test fixture', detail: 'Test fixture', url: 'https://example.test' },
      geometryVerified: true,
      geometryStatus: 'verified',
      warnings: []
    }
  });
  let report = validateCadFEMProject(project);
  assert.ok(!report.errors.some(({ code }) => code.startsWith('catalogue_')));
  (document.features[0] as Extract<typeof document.features[number], { type: 'catalogueExtrusion' }>).section.catalogueRevision = 'stale';
  report = validateCadFEMProject(project);
  assert.ok(report.errors.some(({ code }) => code === 'catalogue_snapshot_invalid'));
});

test('native Ceres evidence controls authoritative sketch degrees of freedom', () => {
  const project = createCadFEMProject('2026-07-18T00:00:00.000Z', 'project-5');
  project.partDocuments[0].sketches.push({
    id: 'sketch-1',
    name: 'Constrained line',
    plane: { type: 'principal', plane: 'XY', offset: 0 },
    points: [{ id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 10, y: 0 }],
    entities: [{ id: 'line-1', type: 'line', startPointId: 'p1', endPointId: 'p2', construction: false }],
    constraints: [],
    solverState: 'underConstrained',
    degreesOfFreedom: 3,
    solveEvidence: {
      kernel: 'ceres',
      kernelVersion: '2.2.0',
      solvedAt: '2026-07-18T00:00:00.000Z',
      iterations: 1,
      residualNorm: 0,
      maximumResidual: 0,
      jacobianRank: 1,
      variableCount: 4,
      constraintEquationCount: 1,
      diagnostics: []
    }
  });
  let report = validateCadFEMProject(project);
  assert.ok(!report.errors.some(({ code }) => code === 'sketch_dof_inconsistent'));
  project.partDocuments[0].sketches[0].degreesOfFreedom = 2;
  report = validateCadFEMProject(project);
  assert.ok(report.errors.some(({ code }) => code === 'sketch_dof_inconsistent'));
});

test('ambiguous persistent topology references block a study until reselected', () => {
  const project = createCadFEMProject('2026-07-18T00:00:00.000Z', 'project-6');
  project.studies[0].supports.push({
    id: 'support-1',
    name: 'Fixed',
    type: 'fixed',
    targets: [{
      documentId: project.partDocuments[0].id,
      bodyId: 'body-1',
      featureId: 'feature-1',
      semanticName: 'Extrude:1/Face:End',
      topologyRevision: 2,
      resolution: 'ambiguous',
      candidateSemanticNames: ['Extrude:1/Face:End', 'Extrude:1/Face:Start'],
      fallbackSignature: {
        kind: 'face',
        centroid: [0, 0, 0],
        measure: 100,
        normal: [0, 0, 1],
        adjacentKinds: ['edge']
      }
    }]
  });
  const report = validateCadFEMProject(project);
  assert.ok(report.errors.some(({ code }) => code === 'topology_reference_ambiguous'));
});
