import {
  FRAME3D_SCHEMA_VERSION,
  effectiveShearModulus,
  type Frame3DModel,
  type LoadCombination
} from '../frame3d-schema';

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const duplicateIds = (values: Array<{ id: string }>): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach(({ id }) => seen.has(id) ? duplicates.add(id) : seen.add(id));
  return [...duplicates];
};

function validateCombination(combination: LoadCombination, loadCaseIds: Set<string>, errors: string[]): void {
  if (!combination.id.trim()) errors.push('Every load combination needs an identifier.');
  Object.entries(combination.factors).forEach(([loadCaseId, factor]) => {
    if (!loadCaseIds.has(loadCaseId)) errors.push(`Combination ${combination.id} references missing load case ${loadCaseId}.`);
    if (!finite(factor)) errors.push(`Combination ${combination.id} has a non-finite factor for ${loadCaseId}.`);
  });
}

export function validateFrameModel(model: Frame3DModel): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!model || typeof model !== 'object') return { valid: false, errors: ['Imported data is not a Frame3D model object.'], warnings };
  if (model.schemaVersion !== FRAME3D_SCHEMA_VERSION) errors.push(`Unsupported Frame3D schema version "${String(model.schemaVersion)}". Supported version: ${FRAME3D_SCHEMA_VERSION}.`);
  if (!model.metadata?.modelName?.trim()) errors.push('The model name is required.');
  if (!Array.isArray(model.nodes) || !model.nodes.length) errors.push('Add at least one node.');
  if (!Array.isArray(model.members) || !model.members.length) errors.push('Add at least one member.');

  const nodeIds = new Set(model.nodes?.map(({ id }) => id) ?? []);
  const materialIds = new Set(model.materials?.map(({ id }) => id) ?? []);
  const sectionIds = new Set(model.sections?.map(({ id }) => id) ?? []);
  const loadCaseIds = new Set(model.loadCases?.map(({ id }) => id) ?? []);

  duplicateIds(model.nodes ?? []).forEach((id) => errors.push(`Node identifier ${id} is duplicated.`));
  duplicateIds(model.members ?? []).forEach((id) => errors.push(`Member identifier ${id} is duplicated.`));
  duplicateIds(model.materials ?? []).forEach((id) => errors.push(`Material identifier ${id} is duplicated.`));
  duplicateIds(model.sections ?? []).forEach((id) => errors.push(`Section identifier ${id} is duplicated.`));
  duplicateIds(model.loadCases ?? []).forEach((id) => errors.push(`Load-case identifier ${id} is duplicated.`));
  duplicateIds(model.combinations ?? []).forEach((id) => errors.push(`Combination identifier ${id} is duplicated.`));
  duplicateIds(model.nodalLoads ?? []).forEach((id) => errors.push(`Nodal-load identifier ${id} is duplicated.`));

  model.nodes?.forEach((node) => {
    if (!node.id.trim()) errors.push('Every node needs an identifier.');
    if (![node.x, node.y, node.z].every(finite)) errors.push(`Node ${node.id || '(unnamed)'} has a non-finite coordinate.`);
    if (!node.restraints || ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'].some((key) => typeof node.restraints[key as keyof typeof node.restraints] !== 'boolean')) {
      errors.push(`Node ${node.id || '(unnamed)'} has malformed restraint data.`);
    }
  });

  model.materials?.forEach((material) => {
    if (!material.id.trim()) errors.push('Every material needs an identifier.');
    if (!positive(material.elasticModulus)) errors.push(`Material ${material.id} requires a positive elastic modulus E.`);
    if (!finite(material.poissonRatio) || material.poissonRatio <= -1 || material.poissonRatio >= 0.5) errors.push(`Material ${material.id} requires -1 < ν < 0.5.`);
    const shear = effectiveShearModulus(material);
    if (!positive(shear)) errors.push(`Material ${material.id} requires a positive shear modulus G.`);
  });

  model.sections?.forEach((section) => {
    if (!section.id.trim()) errors.push('Every section needs an identifier.');
    ([
      ['A', section.area],
      ['Iy', section.iy],
      ['Iz', section.iz],
      ['J', section.torsionConstant]
    ] as const).forEach(([property, value]) => {
      if (!positive(value)) errors.push(`Section ${section.id} requires a positive finite ${property} property.`);
    });
  });

  const connected = new Map<string, number>();
  model.nodes?.forEach(({ id }) => connected.set(id, 0));
  model.members?.forEach((member) => {
    if (!member.id.trim()) errors.push('Every member needs an identifier.');
    if (!nodeIds.has(member.startNodeId)) errors.push(`Member ${member.id} references missing start node ${member.startNodeId}.`);
    if (!nodeIds.has(member.endNodeId)) errors.push(`Member ${member.id} references missing end node ${member.endNodeId}.`);
    if (member.startNodeId === member.endNodeId) errors.push(`Member ${member.id} has identical start and end nodes.`);
    if (!materialIds.has(member.materialId)) errors.push(`Member ${member.id} references missing material ${member.materialId}.`);
    if (!sectionIds.has(member.sectionId)) errors.push(`Member ${member.id} references missing section ${member.sectionId}.`);
    if (!finite(member.rollAngleRad)) errors.push(`Member ${member.id} has a non-finite roll angle.`);
    if (member.localAxisReference && ![member.localAxisReference.x, member.localAxisReference.y, member.localAxisReference.z].every(finite)) {
      errors.push(`Member ${member.id} has a non-finite local-axis reference.`);
    }
    connected.set(member.startNodeId, (connected.get(member.startNodeId) ?? 0) + 1);
    connected.set(member.endNodeId, (connected.get(member.endNodeId) ?? 0) + 1);
    const start = model.nodes?.find(({ id }) => id === member.startNodeId);
    const end = model.nodes?.find(({ id }) => id === member.endNodeId);
    if (start && end && Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) <= 1e-9) errors.push(`Member ${member.id} has zero length.`);
  });
  connected.forEach((count, id) => { if (count === 0) warnings.push(`Node ${id} has no connected members.`); });

  model.loadCases?.forEach((loadCase) => { if (!loadCase.id.trim()) errors.push('Every load case needs an identifier.'); });
  model.combinations?.forEach((combination) => validateCombination(combination, loadCaseIds, errors));
  model.nodalLoads?.forEach((load) => {
    if (!nodeIds.has(load.nodeId)) errors.push(`Load ${load.id} references missing node ${load.nodeId}.`);
    if (!loadCaseIds.has(load.loadCaseId)) errors.push(`Load ${load.id} references missing load case ${load.loadCaseId}.`);
    if (![load.fx, load.fy, load.fz, load.mx, load.my, load.mz].every(finite)) errors.push(`Load ${load.id} has a non-finite component.`);
  });

  const selection = model.analysisSettings?.selection;
  if (!selection) errors.push('Choose a load case or load combination for analysis.');
  else if (selection.type === 'loadCase' && !loadCaseIds.has(selection.id)) errors.push(`Selected load case ${selection.id} does not exist.`);
  else if (selection.type === 'combination' && !model.combinations?.some(({ id }) => id === selection.id)) errors.push(`Selected load combination ${selection.id} does not exist.`);

  const restraintKeys = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const;
  if (!model.nodes?.some(({ restraints }) => restraintKeys.some((key) => restraints[key]))) {
    errors.push('Rigid-body instability: the model has no restrained degrees of freedom.');
  } else {
    restraintKeys.forEach((key) => {
      if (!model.nodes.some(({ restraints }) => restraints[key])) warnings.push(`No node directly restrains ${key.toUpperCase()}; check rigid-body stability.`);
    });
  }
  if (!model.nodalLoads?.length) warnings.push('The model has no nodal loads.');
  return { valid: errors.length === 0, errors, warnings };
}
