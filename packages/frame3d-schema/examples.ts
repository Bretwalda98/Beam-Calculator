import {
  FRAME3D_SCHEMA_VERSION,
  fixedRestraints,
  freeRestraints,
  type Frame3DModel,
  type FrameMember,
  type NodalLoad,
  type Node3D
} from './index';

const material = { id: 'STEEL', name: 'Structural steel', elasticModulus: 200000, poissonRatio: 0.3 };
const section = {
  id: 'RECT',
  designation: 'Benchmark section',
  area: 10000,
  iy: 8e7,
  iz: 5e7,
  torsionConstant: 2e7,
  sourceRevision: 'Analytical benchmark properties'
};
const loadCase = { id: 'LC1', name: 'Benchmark load', category: 'Other' };

function model(
  modelName: string,
  description: string,
  expectedBehaviour: string,
  benchmarkSource: string,
  nodes: Node3D[],
  members: FrameMember[],
  nodalLoads: NodalLoad[]
): Frame3DModel {
  return {
    schemaVersion: FRAME3D_SCHEMA_VERSION,
    metadata: { projectName: 'Frame3D examples', modelName, engineer: '', description, expectedBehaviour, benchmarkSource },
    displayUnits: { force: 'kN', length: 'mm', stress: 'N/mm²', moment: 'kN·m' },
    nodes,
    members,
    materials: [{ ...material }],
    sections: [{ ...section }],
    loadCases: [{ ...loadCase }],
    combinations: [{ id: 'COMB1', name: '1.0 × benchmark load', factors: { LC1: 1 } }],
    nodalLoads,
    analysisSettings: { solver: 'linearStatic', selection: { type: 'loadCase', id: 'LC1' } }
  };
}

const member = (id: string, startNodeId: string, endNodeId: string, rollAngleRad = 0): FrameMember => ({
  id,
  startNodeId,
  endNodeId,
  sectionId: 'RECT',
  materialId: 'STEEL',
  rollAngleRad
});

export const FRAME3D_EXAMPLES: Record<string, () => Frame3DModel> = {
  axial: () => model(
    'Axial cantilever',
    'A 2,000 mm member aligned with global X and fixed at its start.',
    'The loaded end translates only in global X; the fixed support reaction opposes the applied force.',
    'Closed-form axial extension δ = PL/EA.',
    [
      { id: 'N1', x: 0, y: 0, z: 0, restraints: fixedRestraints() },
      { id: 'N2', x: 2000, y: 0, z: 0, restraints: freeRestraints() }
    ],
    [member('M1', 'N1', 'N2')],
    [{ id: 'L1', nodeId: 'N2', loadCaseId: 'LC1', fx: 100000, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }]
  ),
  transverse: () => model(
    'Cantilever with transverse tip load',
    'A 2,000 mm member aligned with global X and fixed at its start.',
    'The loaded end deflects in global Z and rotates about global Y.',
    'Euler–Bernoulli cantilever: δ = PL³/3EI and θ = PL²/2EI.',
    [
      { id: 'N1', x: 0, y: 0, z: 0, restraints: fixedRestraints() },
      { id: 'N2', x: 2000, y: 0, z: 0, restraints: freeRestraints() }
    ],
    [member('M1', 'N1', 'N2')],
    [{ id: 'L1', nodeId: 'N2', loadCaseId: 'LC1', fx: 0, fy: 0, fz: -10000, mx: 0, my: 0, mz: 0 }]
  ),
  torsion: () => model(
    'Cantilever with tip torsion',
    'A 2,000 mm member aligned with global X and fixed at its start.',
    'The loaded end rotates about the member local X axis without translation.',
    'Saint-Venant torsion: θ = TL/GJ.',
    [
      { id: 'N1', x: 0, y: 0, z: 0, restraints: fixedRestraints() },
      { id: 'N2', x: 2000, y: 0, z: 0, restraints: freeRestraints() }
    ],
    [member('M1', 'N1', 'N2')],
    [{ id: 'L1', nodeId: 'N2', loadCaseId: 'LC1', fx: 0, fy: 0, fz: 0, mx: 5e6, my: 0, mz: 0 }]
  ),
  portal: () => model(
    'Simple portal frame',
    'A 5,000 mm by 3,000 mm single-bay portal with fixed column bases.',
    'The frame sways under the horizontal roof-node load and develops balanced base shear and moments.',
    'Reference frame for matrix-method equilibrium and qualitative sway behaviour.',
    [
      { id: 'N1', x: 0, y: 0, z: 0, restraints: fixedRestraints() },
      { id: 'N2', x: 0, y: 0, z: 3000, restraints: freeRestraints() },
      { id: 'N3', x: 5000, y: 0, z: 3000, restraints: freeRestraints() },
      { id: 'N4', x: 5000, y: 0, z: 0, restraints: fixedRestraints() }
    ],
    [member('M1', 'N1', 'N2'), member('M2', 'N2', 'N3'), member('M3', 'N3', 'N4')],
    [{ id: 'L1', nodeId: 'N3', loadCaseId: 'LC1', fx: 25000, fy: 0, fz: -50000, mx: 0, my: 0, mz: 0 }]
  ),
  skew: () => model(
    'Skew three-dimensional frame',
    'A supported skew frame with members extending in all three global directions.',
    'Translations and member actions occur in all three axes while global force and moment equilibrium remain satisfied.',
    'General 3D matrix-method consistency and equilibrium benchmark.',
    [
      { id: 'N1', x: 0, y: 0, z: 0, restraints: fixedRestraints() },
      { id: 'N2', x: 3000, y: 1000, z: 2500, restraints: freeRestraints() },
      { id: 'N3', x: 6000, y: -1200, z: 3200, restraints: freeRestraints() },
      { id: 'N4', x: 7000, y: 2500, z: 0, restraints: fixedRestraints() }
    ],
    [member('M1', 'N1', 'N2'), member('M2', 'N2', 'N3', Math.PI / 9), member('M3', 'N3', 'N4')],
    [{ id: 'L1', nodeId: 'N2', loadCaseId: 'LC1', fx: 12000, fy: -18000, fz: -30000, mx: 2e6, my: 0, mz: -1e6 }]
  ),
  unstable: () => model(
    'Deliberately unstable model',
    'A single horizontal member with no restrained degrees of freedom.',
    'Validation identifies unrestrained rigid-body motion and the solver refuses to produce structural results.',
    'Diagnostic example; no numerical result is expected.',
    [
      { id: 'N1', x: 0, y: 0, z: 0, restraints: freeRestraints() },
      { id: 'N2', x: 2000, y: 0, z: 0, restraints: freeRestraints() }
    ],
    [member('M1', 'N1', 'N2')],
    [{ id: 'L1', nodeId: 'N2', loadCaseId: 'LC1', fx: 0, fy: 0, fz: -10000, mx: 0, my: 0, mz: 0 }]
  )
};

export const DEFAULT_FRAME3D_EXAMPLE = 'portal';
