export const FRAME3D_SCHEMA_VERSION = '1.0.0' as const;
export const FRAME3D_SOLVER_VERSION = '1.0.0' as const;

export type Vector3 = [number, number, number];
export type Dof6 = [number, number, number, number, number, number];
export type AnalysisState = 'Ready' | 'Validating' | 'Assembling' | 'Solving' | 'Recovering results' | 'Complete' | 'Failed' | 'Cancelled';

export interface Frame3DMetadata {
  projectName: string;
  modelName: string;
  engineer: string;
  description?: string;
  expectedBehaviour?: string;
  benchmarkSource?: string;
}

export interface Frame3DDisplayUnits {
  force: 'N' | 'kN';
  length: 'mm' | 'm';
  stress: 'N/mm²';
  moment: 'N·mm' | 'kN·m';
}

export interface Restraints3D {
  ux: boolean;
  uy: boolean;
  uz: boolean;
  rx: boolean;
  ry: boolean;
  rz: boolean;
}

export interface Node3D {
  id: string;
  x: number;
  y: number;
  z: number;
  restraints: Restraints3D;
}

export interface LocalAxisReference {
  x: number;
  y: number;
  z: number;
}

export interface FrameMember {
  id: string;
  startNodeId: string;
  endNodeId: string;
  sectionId: string;
  materialId: string;
  rollAngleRad: number;
  localAxisReference?: LocalAxisReference;
}

export interface Material {
  id: string;
  name: string;
  elasticModulus: number;
  poissonRatio: number;
  shearModulus?: number;
}

export interface SectionSnapshot {
  id: string;
  designation: string;
  sourceSectionId?: string;
  area: number;
  iy: number;
  iz: number;
  torsionConstant: number;
  catalogueRevision?: string;
  profile?: {
    schemaVersion: '1.0.0';
    catalogue: 'beam-ec3';
    catalogueRevision: string;
    sectionId: string;
    designation: string;
    family: string;
    kind: 'i' | 'channel' | 'rhs';
    units: 'mm';
    dimensions: Record<string, number | null>;
    properties: Record<string, number | null>;
    source: { title: string; detail: string; url: string };
    geometryVerified: boolean;
    geometryStatus: string;
    warnings: string[];
  };
  sourceRevision?: string;
}

export interface NodalLoad {
  id: string;
  nodeId: string;
  loadCaseId: string;
  fx: number;
  fy: number;
  fz: number;
  mx: number;
  my: number;
  mz: number;
}

export interface LoadCase {
  id: string;
  name: string;
  category: string;
}

export interface LoadCombination {
  id: string;
  name: string;
  factors: Record<string, number>;
}

export interface AnalysisSelection {
  type: 'loadCase' | 'combination';
  id: string;
}

export interface AnalysisSettings {
  solver: 'linearStatic';
  selection: AnalysisSelection;
}

export interface Frame3DModel {
  schemaVersion: typeof FRAME3D_SCHEMA_VERSION;
  metadata: Frame3DMetadata;
  displayUnits: Frame3DDisplayUnits;
  nodes: Node3D[];
  members: FrameMember[];
  materials: Material[];
  sections: SectionSnapshot[];
  loadCases: LoadCase[];
  combinations: LoadCombination[];
  nodalLoads: NodalLoad[];
  analysisSettings: AnalysisSettings;
}

export interface NodeResult {
  nodeId: string;
  translations: Vector3;
  rotations: Vector3;
}

export interface ReactionResult {
  nodeId: string;
  forces: Vector3;
  moments: Vector3;
}

export interface MemberResult {
  memberId: string;
  startForces: Dof6;
  endForces: Dof6;
  localAxes: [Vector3, Vector3, Vector3];
}

export interface EquilibriumSummary {
  forceResidual: Vector3;
  momentResidual: Vector3;
  normalisedForceResidual: number;
  normalisedMomentResidual: number;
  normalisedResidual: number;
}

export interface SolverMetadata {
  solver: string;
  solverVersion: string;
  schemaVersion: string;
  numericalLibrary: string;
  analysisSelection: AnalysisSelection;
  dofCount: number;
  freeDofCount: number;
  restrainedDofCount: number;
  conditionEstimate: number | null;
}

export interface FrameResult {
  status: 'ok';
  nodes: NodeResult[];
  reactions: ReactionResult[];
  members: MemberResult[];
  maximumDisplacementMagnitude: number;
  equilibrium: EquilibriumSummary;
  warnings: string[];
  errors: string[];
  metadata: SolverMetadata;
}

export interface SolverError {
  status: 'error';
  stage: string;
  message: string;
  warnings: string[];
  errors: string[];
}

export type SolverResponse = FrameResult | SolverError;

export interface SolverProgressMessage {
  type: 'progress';
  requestId: number;
  modelRevision: number;
  state: AnalysisState;
}

export interface SolverResultMessage {
  type: 'result';
  requestId: number;
  modelRevision: number;
  response: SolverResponse;
}

export type SolverWorkerMessage = SolverProgressMessage | SolverResultMessage;

export interface Frame3DSectionLibraryItem {
  id: string;
  designation: string;
  family: string;
  available: boolean;
  missingProperties: string[];
  snapshot: SectionSnapshot | null;
}

export const fixedRestraints = (): Restraints3D => ({ ux: true, uy: true, uz: true, rx: true, ry: true, rz: true });
export const freeRestraints = (): Restraints3D => ({ ux: false, uy: false, uz: false, rx: false, ry: false, rz: false });

export function effectiveShearModulus(material: Material): number {
  return material.shearModulus ?? material.elasticModulus / (2 * (1 + material.poissonRatio));
}

export function createEmptyModel(): Frame3DModel {
  return {
    schemaVersion: FRAME3D_SCHEMA_VERSION,
    metadata: { projectName: '', modelName: 'Untitled frame', engineer: '' },
    displayUnits: { force: 'kN', length: 'mm', stress: 'N/mm²', moment: 'kN·m' },
    nodes: [],
    members: [],
    materials: [{ id: 'MAT1', name: 'Structural steel', elasticModulus: 210000, poissonRatio: 0.3 }],
    sections: [{ id: 'SEC1', designation: 'Custom section', area: 10000, iy: 8e7, iz: 5e7, torsionConstant: 2e7, sourceRevision: 'User-defined' }],
    loadCases: [{ id: 'LC1', name: 'Load case 1', category: 'Other' }],
    combinations: [],
    nodalLoads: [],
    analysisSettings: { solver: 'linearStatic', selection: { type: 'loadCase', id: 'LC1' } }
  };
}
