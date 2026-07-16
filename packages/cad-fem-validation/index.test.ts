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
