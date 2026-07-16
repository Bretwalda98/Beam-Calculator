export const CAD_FEM_SCHEMA_VERSION = '1.0.0' as const;
export const CAD_FEM_API_VERSION = '1.0.0' as const;

export type UUID = string;
export type Vector3 = [number, number, number];
export type Quaternion = [number, number, number, number];
export type Matrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

export interface CadFEMDisplayUnits {
  length: 'mm' | 'm';
  force: 'N' | 'kN';
  stress: 'N/mm²' | 'MPa';
  moment: 'N·mm' | 'kN·m';
  mass: 'kg';
}

export interface CadFEMMetadata {
  name: string;
  description: string;
  engineer: string;
  organisation: string;
  createdAt: string;
  updatedAt: string;
}

export interface TopologySignature {
  kind: 'vertex' | 'edge' | 'face' | 'solid';
  centroid: Vector3;
  measure: number;
  normal?: Vector3;
  adjacentKinds: string[];
}

export interface TopologyRef {
  documentId: UUID;
  bodyId: UUID;
  featureId: UUID;
  semanticName: string;
  topologyRevision: number;
  fallbackSignature: TopologySignature;
}

export type SketchPlane =
  | { type: 'principal'; plane: 'XY' | 'YZ' | 'XZ'; offset: number }
  | { type: 'face'; face: TopologyRef };

export interface SketchPoint {
  id: UUID;
  x: number;
  y: number;
}

export interface SketchLine {
  id: UUID;
  type: 'line';
  startPointId: UUID;
  endPointId: UUID;
  construction: boolean;
}

export interface SketchArc {
  id: UUID;
  type: 'arc';
  centrePointId: UUID;
  startPointId: UUID;
  endPointId: UUID;
  clockwise: boolean;
  construction: boolean;
}

export interface SketchCircle {
  id: UUID;
  type: 'circle';
  centrePointId: UUID;
  radius: number;
  construction: boolean;
}

export type SketchEntity = SketchLine | SketchArc | SketchCircle;

export type SketchConstraint =
  | { id: UUID; type: 'coincident'; entityA: UUID; pointA?: 'start' | 'end' | 'centre'; entityB: UUID; pointB?: 'start' | 'end' | 'centre' }
  | { id: UUID; type: 'horizontal' | 'vertical'; entityId: UUID }
  | { id: UUID; type: 'parallel' | 'perpendicular' | 'equal'; entityA: UUID; entityB: UUID }
  | { id: UUID; type: 'tangent'; entityA: UUID; entityB: UUID }
  | { id: UUID; type: 'distance'; pointA: UUID; pointB: UUID; value: number }
  | { id: UUID; type: 'horizontalDistance' | 'verticalDistance'; pointA: UUID; pointB: UUID; value: number }
  | { id: UUID; type: 'radius' | 'diameter'; entityId: UUID; value: number }
  | { id: UUID; type: 'angle'; entityA: UUID; entityB: UUID; valueRad: number }
  | { id: UUID; type: 'fixed'; pointId: UUID };

export interface Sketch {
  id: UUID;
  name: string;
  plane: SketchPlane;
  points: SketchPoint[];
  entities: SketchEntity[];
  constraints: SketchConstraint[];
  solverState: 'notSolved' | 'underConstrained' | 'fullyConstrained' | 'overConstrained' | 'failed';
  degreesOfFreedom: number | null;
}

export interface FeatureBase {
  id: UUID;
  name: string;
  suppressed: boolean;
}

export type PartFeature =
  | (FeatureBase & { type: 'sketch'; sketchId: UUID })
  | (FeatureBase & { type: 'extrude'; sketchId: UUID; distance: number; direction: 'normal' | 'reverse' | 'symmetric'; operation: 'newBody' | 'add' | 'cut' | 'intersect'; targetBodyIds: UUID[] })
  | (FeatureBase & { type: 'revolve'; sketchId: UUID; axisEntityId: UUID; angleRad: number; operation: 'newBody' | 'add' | 'cut' | 'intersect'; targetBodyIds: UUID[] })
  | (FeatureBase & { type: 'boolean'; operation: 'fuse' | 'cut' | 'common'; targetBodyId: UUID; toolBodyIds: UUID[] })
  | (FeatureBase & { type: 'fillet' | 'chamfer'; edges: TopologyRef[]; size: number })
  | (FeatureBase & { type: 'hole'; placement: TopologyRef; centre: [number, number]; diameter: number; depth: number | 'throughAll'; holeType: 'simple' | 'counterbore' | 'countersink'; counterDiameter?: number; counterDepth?: number; counterAngleRad?: number })
  | (FeatureBase & { type: 'linearPattern'; sourceFeatureIds: UUID[]; direction: Vector3; spacing: number; count: number })
  | (FeatureBase & { type: 'circularPattern'; sourceFeatureIds: UUID[]; axisOrigin: Vector3; axisDirection: Vector3; angleRad: number; count: number });

export interface PartBody {
  id: UUID;
  name: string;
  sourceFeatureId: UUID;
  materialId: UUID | null;
  visible: boolean;
  topologyRevision: number;
}

export interface PartDocument {
  id: UUID;
  name: string;
  geometryRevision: number;
  sketches: Sketch[];
  features: PartFeature[];
  bodies: PartBody[];
  importedStepArtifactId?: UUID;
}

export interface AssemblyComponent {
  id: UUID;
  name: string;
  partDocumentId: UUID;
  transform: Matrix4;
  grounded: boolean;
  visible: boolean;
}

export type AssemblyMate =
  | { id: UUID; name: string; type: 'fixed'; componentId: UUID }
  | { id: UUID; name: string; type: 'coincidentPlanar'; componentA: UUID; faceA: TopologyRef; componentB: UUID; faceB: TopologyRef; offset: number; flipped: boolean }
  | { id: UUID; name: string; type: 'concentric'; componentA: UUID; faceA: TopologyRef; componentB: UUID; faceB: TopologyRef; allowRotation: boolean }
  | { id: UUID; name: string; type: 'distance'; componentA: UUID; faceA: TopologyRef; componentB: UUID; faceB: TopologyRef; distance: number }
  | { id: UUID; name: string; type: 'angle'; componentA: UUID; faceA: TopologyRef; componentB: UUID; faceB: TopologyRef; angleRad: number };

export interface Assembly {
  id: UUID;
  name: string;
  revision: number;
  components: AssemblyComponent[];
  mates: AssemblyMate[];
}

export interface SolidMaterial {
  id: UUID;
  name: string;
  elasticModulus: number;
  poissonRatio: number;
  density?: number;
  source: 'user' | 'library';
  sourceRevision?: string;
}

export interface BodyMaterialAssignment {
  componentId: UUID;
  bodyId: UUID;
  materialId: UUID;
}

export interface MeshControl {
  id: UUID;
  name: string;
  targets: TopologyRef[];
  maximumSize: number;
}

export interface MeshSettings {
  elementOrder: 1 | 2;
  globalSize: number;
  minimumSize: number;
  curvatureRefinement: boolean;
  growthRate: number;
  controls: MeshControl[];
  quality: {
    minimumScaledJacobian: number;
    maximumAspectRatio: number;
  };
}

export type Support =
  | { id: UUID; name: string; type: 'fixed'; targets: TopologyRef[] }
  | { id: UUID; name: string; type: 'displacement'; targets: TopologyRef[]; ux: number | null; uy: number | null; uz: number | null };

export type SolidLoad =
  | { id: UUID; name: string; type: 'pressure'; targets: TopologyRef[]; magnitude: number }
  | { id: UUID; name: string; type: 'traction'; targets: TopologyRef[]; vector: Vector3 }
  | { id: UUID; name: string; type: 'totalForce'; targets: TopologyRef[]; vector: Vector3 }
  | { id: UUID; name: string; type: 'gravity'; acceleration: Vector3 };

export interface ContactPair {
  id: UUID;
  name: string;
  type: 'bonded' | 'frictionless';
  primary: TopologyRef[];
  secondary: TopologyRef[];
  formulation: 'conforming' | 'mortar';
  enabled: boolean;
}

export interface SolidSolverSettings {
  analysisType: 'linearStatic' | 'nonlinearContact';
  relativeTolerance: number;
  absoluteTolerance: number;
  maximumIterations: number;
  loadSteps: number;
  minimumStepFraction: number;
  automaticCutback: boolean;
}

export interface SolidStudy {
  id: UUID;
  name: string;
  geometryRevision: number;
  materialAssignments: BodyMaterialAssignment[];
  supports: Support[];
  loads: SolidLoad[];
  contacts: ContactPair[];
  mesh: MeshSettings;
  solver: SolidSolverSettings;
}

export interface CadFEMProject {
  schemaVersion: typeof CAD_FEM_SCHEMA_VERSION;
  id: UUID;
  revision: number;
  metadata: CadFEMMetadata;
  displayUnits: CadFEMDisplayUnits;
  partDocuments: PartDocument[];
  assembly: Assembly;
  materials: SolidMaterial[];
  studies: SolidStudy[];
}

export type CadCommand =
  | { type: 'renameProject'; name: string }
  | { type: 'upsertSketch'; documentId: UUID; sketch: Sketch }
  | { type: 'appendFeature'; documentId: UUID; feature: PartFeature }
  | { type: 'updateFeature'; documentId: UUID; feature: PartFeature }
  | { type: 'suppressFeature'; documentId: UUID; featureId: UUID; suppressed: boolean }
  | { type: 'upsertComponent'; component: AssemblyComponent }
  | { type: 'upsertMate'; mate: AssemblyMate }
  | { type: 'upsertMaterial'; material: SolidMaterial }
  | { type: 'upsertStudy'; study: SolidStudy };

export interface CadCommandRequest {
  commandId: UUID;
  baseRevision: number;
  command: CadCommand;
}

export interface CadCommandResult {
  commandId: UUID;
  projectId: UUID;
  revision: number;
  geometryRevision: number;
  tessellationArtifactId?: UUID;
  warnings: string[];
}

export type JobKind = 'stepImport' | 'stepExport' | 'regenerate' | 'mesh' | 'solve' | 'postprocess';
export type JobStage = 'queued' | 'preparing' | 'regenerating' | 'meshing' | 'assembling' | 'solving' | 'recovering' | 'uploading' | 'complete' | 'failed' | 'cancelled';

export interface JobDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  entityIds: UUID[];
}

export interface ArtifactReference {
  id: UUID;
  kind: 'step' | 'ocaf' | 'brep' | 'topology' | 'tessellation' | 'mesh' | 'vtu' | 'csv' | 'log' | 'resultField';
  contentType: string;
  byteLength: number;
  sha256: string;
}

export interface JobManifest {
  apiVersion: typeof CAD_FEM_API_VERSION;
  id: UUID;
  projectId: UUID;
  studyId?: UUID;
  kind: JobKind;
  stage: JobStage;
  progress: number;
  inputHash: string;
  idempotencyKey: string;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancellationRequested: boolean;
  diagnostics: JobDiagnostic[];
  artifacts: ArtifactReference[];
  solverVersions: Record<string, string>;
}

export interface ResultExtremum {
  field: string;
  minimum: number;
  maximum: number;
  minimumPosition: Vector3;
  maximumPosition: Vector3;
}

export interface ResultManifest {
  apiVersion: typeof CAD_FEM_API_VERSION;
  jobId: UUID;
  projectId: UUID;
  studyId: UUID;
  projectRevision: number;
  geometryRevision: number;
  modelHash: string;
  meshHash: string;
  converged: boolean;
  equilibriumResidual: number;
  contactPenetrationRatio?: number;
  strainEnergy: number;
  extrema: ResultExtremum[];
  convergenceHistory: Array<{
    loadStep: number;
    iteration: number;
    residual: number;
    activeContacts: number;
    accepted: boolean;
  }>;
  diagnostics: JobDiagnostic[];
  artifacts: ArtifactReference[];
}

export function identityMatrix4(): Matrix4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function createCadFEMProject(now = new Date().toISOString(), id: string = crypto.randomUUID()): CadFEMProject {
  const partId = crypto.randomUUID();
  const assemblyId = crypto.randomUUID();
  const materialId = crypto.randomUUID();
  const studyId = crypto.randomUUID();
  return {
    schemaVersion: CAD_FEM_SCHEMA_VERSION,
    id,
    revision: 0,
    metadata: {
      name: 'Untitled solid project',
      description: '',
      engineer: '',
      organisation: '',
      createdAt: now,
      updatedAt: now
    },
    displayUnits: {
      length: 'mm',
      force: 'N',
      stress: 'MPa',
      moment: 'N·mm',
      mass: 'kg'
    },
    partDocuments: [{
      id: partId,
      name: 'Part 1',
      geometryRevision: 0,
      sketches: [],
      features: [],
      bodies: []
    }],
    assembly: {
      id: assemblyId,
      name: 'Main assembly',
      revision: 0,
      components: [],
      mates: []
    },
    materials: [{
      id: materialId,
      name: 'Structural steel',
      elasticModulus: 210000,
      poissonRatio: 0.3,
      density: 7.85e-6,
      source: 'user'
    }],
    studies: [{
      id: studyId,
      name: 'Linear static study',
      geometryRevision: 0,
      materialAssignments: [],
      supports: [],
      loads: [],
      contacts: [],
      mesh: {
        elementOrder: 2,
        globalSize: 10,
        minimumSize: 1,
        curvatureRefinement: true,
        growthRate: 1.3,
        controls: [],
        quality: {
          minimumScaledJacobian: 0.1,
          maximumAspectRatio: 20
        }
      },
      solver: {
        analysisType: 'linearStatic',
        relativeTolerance: 1e-8,
        absoluteTolerance: 1e-12,
        maximumIterations: 500,
        loadSteps: 1,
        minimumStepFraction: 0.01,
        automaticCutback: false
      }
    }]
  };
}
