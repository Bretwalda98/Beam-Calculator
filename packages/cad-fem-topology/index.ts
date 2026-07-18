import type {
  CadFEMProject,
  PartDocument,
  PartFeature,
  TopologyRef,
  TopologySignature
} from '../cad-fem-schema';

export interface NativeTopologyCandidate {
  documentId: string;
  bodyId: string;
  featureId: string;
  semanticName: string;
  topologyRevision: number;
  fallbackSignature: TopologySignature;
}

export interface RegenerationDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  message: string;
  entityIds: string[];
}

export interface RegenerationManifest {
  apiVersion: '1.0.0';
  schemaVersion: '1.0.0';
  projectId: string;
  projectRevision: number;
  documentId: string;
  geometryRevision: number;
  units: { length: 'mm'; angle: 'rad' };
  sketches: PartDocument['sketches'];
  orderedFeatures: PartFeature[];
  existingBodies: PartDocument['bodies'];
  diagnostics: RegenerationDiagnostic[];
}

export function semanticSubshapeName(
  feature: PartFeature,
  featureIndex: number,
  kind: TopologySignature['kind'],
  role: string,
  ordinal = 1
): string {
  const safeRole = role.trim().replace(/[^a-z0-9_-]+/gi, '-') || 'Generated';
  return `Feature:${featureIndex + 1}:${feature.type}:${feature.id}/${kind[0].toUpperCase()}${kind.slice(1)}:${safeRole}:${ordinal}`;
}

export function createRegenerationManifest(project: CadFEMProject, documentId: string): RegenerationManifest {
  const document = project.partDocuments.find(({ id }) => id === documentId);
  if (!document) throw new Error(`Part document ${documentId} does not exist.`);
  const diagnostics: RegenerationDiagnostic[] = [];
  const referencedSketchIds = new Set(document.features.flatMap((feature) => (
    !feature.suppressed && 'sketchId' in feature ? [feature.sketchId] : []
  )));
  for (const sketch of document.sketches) {
    if (!referencedSketchIds.has(sketch.id)) continue;
    if (!sketch.solveEvidence || sketch.solveEvidence.kernel !== 'ceres') {
      diagnostics.push({
        severity: 'error', code: 'native_sketch_evidence_required',
        message: `${sketch.name} must be solved by the native Ceres kernel before OCCT regeneration.`,
        entityIds: [sketch.id]
      });
    } else if (['overConstrained', 'failed'].includes(sketch.solverState)) {
      diagnostics.push({
        severity: 'error', code: 'sketch_solution_invalid',
        message: `${sketch.name} cannot regenerate while its constraint state is ${sketch.solverState}.`,
        entityIds: [sketch.id]
      });
    } else if (sketch.solverState === 'underConstrained') {
      diagnostics.push({
        severity: 'warning', code: 'sketch_under_constrained',
        message: `${sketch.name} is under-constrained; regeneration uses its current solved coordinates.`,
        entityIds: [sketch.id]
      });
    }
  }
  return {
    apiVersion: '1.0.0',
    schemaVersion: project.schemaVersion,
    projectId: project.id,
    projectRevision: project.revision,
    documentId: document.id,
    geometryRevision: document.geometryRevision,
    units: { length: 'mm', angle: 'rad' },
    sketches: structuredClone(document.sketches),
    orderedFeatures: structuredClone(document.features),
    existingBodies: structuredClone(document.bodies),
    diagnostics
  };
}

function relativeDifference(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
}

function signatureScore(reference: TopologySignature, candidate: TopologySignature): number {
  if (reference.kind !== candidate.kind) return Number.POSITIVE_INFINITY;
  const centroidScale = Math.max(1, ...reference.centroid.map(Math.abs), ...candidate.centroid.map(Math.abs));
  const centroid = Math.hypot(
    reference.centroid[0] - candidate.centroid[0],
    reference.centroid[1] - candidate.centroid[1],
    reference.centroid[2] - candidate.centroid[2]
  ) / centroidScale;
  const measure = relativeDifference(reference.measure, candidate.measure);
  if (centroid > 1e-4 || measure > 1e-4) return Number.POSITIVE_INFINITY;
  let normal = 0;
  if (reference.normal && candidate.normal) {
    const dot = reference.normal[0] * candidate.normal[0] +
      reference.normal[1] * candidate.normal[1] +
      reference.normal[2] * candidate.normal[2];
    normal = 1 - Math.abs(dot);
    if (normal > 1e-4) return Number.POSITIVE_INFINITY;
  }
  const referenceAdjacency = [...reference.adjacentKinds].sort().join('|');
  const candidateAdjacency = [...candidate.adjacentKinds].sort().join('|');
  if (referenceAdjacency !== candidateAdjacency) return Number.POSITIVE_INFINITY;
  return centroid + measure + normal;
}

function resolvedReference(reference: TopologyRef, candidate: NativeTopologyCandidate): TopologyRef {
  return {
    ...reference,
    documentId: candidate.documentId,
    bodyId: candidate.bodyId,
    featureId: candidate.featureId,
    semanticName: candidate.semanticName,
    topologyRevision: candidate.topologyRevision,
    fallbackSignature: structuredClone(candidate.fallbackSignature),
    resolution: 'resolved',
    candidateSemanticNames: undefined
  };
}

export function resolveTopologyReference(
  reference: TopologyRef,
  candidates: NativeTopologyCandidate[]
): TopologyRef {
  const scoped = candidates.filter((candidate) => (
    candidate.documentId === reference.documentId &&
    candidate.bodyId === reference.bodyId &&
    candidate.featureId === reference.featureId
  ));
  const semanticMatches = scoped.filter(({ semanticName }) => semanticName === reference.semanticName);
  if (semanticMatches.length === 1) return resolvedReference(reference, semanticMatches[0]);
  if (semanticMatches.length > 1) {
    return {
      ...reference,
      resolution: 'ambiguous',
      candidateSemanticNames: semanticMatches.map(({ semanticName }) => semanticName)
    };
  }
  const ranked = scoped
    .map((candidate) => ({ candidate, score: signatureScore(reference.fallbackSignature, candidate.fallbackSignature) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || a.candidate.semanticName.localeCompare(b.candidate.semanticName));
  if (!ranked.length) return { ...reference, resolution: 'broken', candidateSemanticNames: [] };
  if (ranked.length > 1 && Math.abs(ranked[0].score - ranked[1].score) <= 1e-8) {
    return {
      ...reference,
      resolution: 'ambiguous',
      candidateSemanticNames: ranked.filter(({ score }) => Math.abs(score - ranked[0].score) <= 1e-8)
        .map(({ candidate }) => candidate.semanticName)
    };
  }
  return resolvedReference(reference, ranked[0].candidate);
}
