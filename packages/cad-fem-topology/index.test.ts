import assert from 'node:assert/strict';
import test from 'node:test';
import { createCadFEMProject, type TopologyRef } from '../cad-fem-schema';
import {
  createRegenerationManifest,
  resolveTopologyReference,
  semanticSubshapeName,
  type NativeTopologyCandidate
} from './index';

const reference: TopologyRef = {
  documentId: 'document', bodyId: 'body', featureId: 'feature',
  semanticName: 'Feature:1:extrude:feature/Face:End:1', topologyRevision: 1,
  fallbackSignature: {
    kind: 'face', centroid: [0, 0, 20], measure: 800,
    normal: [0, 0, 1], adjacentKinds: ['edge']
  }
};

function candidate(name: string, x = 0): NativeTopologyCandidate {
  return {
    documentId: 'document', bodyId: 'body', featureId: 'feature', semanticName: name,
    topologyRevision: 2,
    fallbackSignature: {
      kind: 'face', centroid: [x, 0, 20], measure: 800,
      normal: [0, 0, 1], adjacentKinds: ['edge']
    }
  };
}

test('semantic topology names are deterministic from feature history', () => {
  const project = createCadFEMProject('2026-07-18T00:00:00.000Z', 'project');
  const feature = {
    id: 'feature', name: 'Sketch', type: 'sketch' as const,
    sketchId: 'sketch', suppressed: false
  };
  assert.equal(
    semanticSubshapeName(feature, 0, 'face', 'End', 1),
    'Feature:1:sketch:feature/Face:End:1'
  );
  const manifest = createRegenerationManifest(project, project.partDocuments[0].id);
  assert.equal(manifest.units.length, 'mm');
  assert.deepEqual(manifest.orderedFeatures, []);
});

test('semantic match wins before the geometric fallback signature', () => {
  const resolved = resolveTopologyReference(reference, [candidate(reference.semanticName, 100)]);
  assert.equal(resolved.resolution, 'resolved');
  assert.equal(resolved.topologyRevision, 2);
});

test('geometric fallback resolves one renamed subshape but rejects ambiguity', () => {
  const renamed = resolveTopologyReference(reference, [candidate('Feature:1:extrude:feature/Face:Generated:1', 0.001)]);
  assert.equal(renamed.resolution, 'resolved');
  assert.match(renamed.semanticName, /Generated/);
  const ambiguous = resolveTopologyReference(reference, [candidate('Face:A'), candidate('Face:B')]);
  assert.equal(ambiguous.resolution, 'ambiguous');
  assert.deepEqual(ambiguous.candidateSemanticNames, ['Face:A', 'Face:B']);
  const broken = resolveTopologyReference(reference, [candidate('Face:Far', 50)]);
  assert.equal(broken.resolution, 'broken');
});

test('regeneration contract requires Ceres evidence for referenced sketches', () => {
  const project = createCadFEMProject('2026-07-18T00:00:00.000Z', 'project');
  const document = project.partDocuments[0];
  document.sketches.push({
    id: 'sketch', name: 'Profile', plane: { type: 'principal', plane: 'XY', offset: 0 },
    points: [], entities: [], constraints: [], solverState: 'notSolved', degreesOfFreedom: null
  });
  document.features.push({ id: 'feature', name: 'Profile', type: 'sketch', sketchId: 'sketch', suppressed: false });
  const manifest = createRegenerationManifest(project, document.id);
  assert.ok(manifest.diagnostics.some(({ code }) => code === 'native_sketch_evidence_required'));
});
