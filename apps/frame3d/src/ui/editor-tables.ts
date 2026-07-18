import type { Frame3DModel, LoadCombination, Material, NodalLoad, Node3D, SectionSnapshot } from '../../../../packages/frame3d-schema';
import { actionButton, cell, checkboxInput, clear, numberInput, selectInput, textInput } from './dom';

export interface EditorActions {
  changed: () => void;
  duplicate: (collection: keyof Pick<Frame3DModel, 'nodes' | 'members' | 'materials' | 'sections' | 'nodalLoads' | 'loadCases' | 'combinations'>, index: number) => void;
  remove: (collection: keyof Pick<Frame3DModel, 'nodes' | 'members' | 'materials' | 'sections' | 'nodalLoads' | 'loadCases' | 'combinations'>, index: number) => void;
}

function actionCell(row: HTMLTableRowElement, collection: Parameters<EditorActions['duplicate']>[0], index: number, actions: EditorActions): void {
  const host = document.createElement('div');
  host.className = 'row-actions';
  host.append(actionButton('Duplicate', () => actions.duplicate(collection, index)));
  host.append(actionButton('Delete', () => actions.remove(collection, index), 'table-action danger'));
  cell(row, host);
}

function renderRows(hostId: string, rows: number, renderer: (row: HTMLTableRowElement, index: number) => void): void {
  const body = document.querySelector<HTMLTableSectionElement>(`#${hostId} tbody`);
  if (!body) throw new Error(`Missing table body for ${hostId}.`);
  clear(body);
  for (let index = 0; index < rows; index += 1) renderer(body.insertRow(), index);
}

export function renderNodeTable(model: Frame3DModel, actions: EditorActions): void {
  const keys = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'] as const;
  renderRows('nodes-table', model.nodes.length, (row, index) => {
    const node = model.nodes[index];
    cell(row, textInput(node.id, `Node ${index + 1} ID`, (value) => { node.id = value; actions.changed(); }));
    (['x', 'y', 'z'] as const).forEach((key) => cell(row, numberInput(node[key], `Node ${node.id} ${key.toUpperCase()} coordinate in mm`, (value) => { node[key] = value; actions.changed(); })));
    keys.forEach((key) => cell(row, checkboxInput(node.restraints[key], `Node ${node.id} ${key.toUpperCase()} restraint`, (value) => { node.restraints[key] = value; actions.changed(); })));
    actionCell(row, 'nodes', index, actions);
  });
}

export function renderMemberTable(model: Frame3DModel, actions: EditorActions): void {
  const nodes = model.nodes.map(({ id }) => [id, id] as [string, string]);
  const materials = model.materials.map(({ id, name }) => [id, `${id} — ${name}`] as [string, string]);
  const sections = model.sections.map(({ id, designation }) => [id, `${id} — ${designation}`] as [string, string]);
  renderRows('members-table', model.members.length, (row, index) => {
    const member = model.members[index];
    cell(row, textInput(member.id, `Member ${index + 1} ID`, (value) => { member.id = value; actions.changed(); }));
    cell(row, selectInput(member.startNodeId, nodes, `Member ${member.id} start node`, (value) => { member.startNodeId = value; actions.changed(); }));
    cell(row, selectInput(member.endNodeId, nodes, `Member ${member.id} end node`, (value) => { member.endNodeId = value; actions.changed(); }));
    cell(row, selectInput(member.materialId, materials, `Member ${member.id} material`, (value) => { member.materialId = value; actions.changed(); }));
    cell(row, selectInput(member.sectionId, sections, `Member ${member.id} section`, (value) => { member.sectionId = value; actions.changed(); }));
    cell(row, numberInput(member.rollAngleRad, `Member ${member.id} roll angle in radians`, (value) => { member.rollAngleRad = value; actions.changed(); }));
    const reference = member.localAxisReference;
    (['x', 'y', 'z'] as const).forEach((key) => cell(row, numberInput(reference?.[key], `Member ${member.id} local-axis reference ${key.toUpperCase()}`, (value) => {
      member.localAxisReference ??= { x: 0, y: 0, z: 0 };
      member.localAxisReference[key] = value;
      actions.changed();
    })));
    actionCell(row, 'members', index, actions);
  });
}

export function renderMaterialTable(model: Frame3DModel, actions: EditorActions): void {
  renderRows('materials-table', model.materials.length, (row, index) => {
    const material: Material = model.materials[index];
    cell(row, textInput(material.id, `Material ${index + 1} ID`, (value) => { material.id = value; actions.changed(); }));
    cell(row, textInput(material.name, `Material ${material.id} name`, (value) => { material.name = value; actions.changed(); }));
    cell(row, numberInput(material.elasticModulus, `Material ${material.id} E in N/mm²`, (value) => { material.elasticModulus = value; actions.changed(); }));
    cell(row, numberInput(material.poissonRatio, `Material ${material.id} Poisson ratio`, (value) => { material.poissonRatio = value; actions.changed(); }));
    cell(row, numberInput(material.shearModulus, `Material ${material.id} G in N/mm²; blank derives from E and Poisson ratio`, (value) => { material.shearModulus = Number.isFinite(value) ? value : undefined; actions.changed(); }));
    actionCell(row, 'materials', index, actions);
  });
}

export function renderSectionTable(model: Frame3DModel, actions: EditorActions): void {
  renderRows('sections-table', model.sections.length, (row, index) => {
    const section: SectionSnapshot = model.sections[index];
    cell(row, textInput(section.id, `Section ${index + 1} ID`, (value) => { section.id = value; actions.changed(); }));
    cell(row, textInput(section.designation, `Section ${section.id} designation`, (value) => { section.designation = value; actions.changed(); }));
    cell(row, numberInput(section.area, `Section ${section.id} area in mm²`, (value) => { section.area = value; actions.changed(); }));
    cell(row, numberInput(section.iy, `Section ${section.id} Iy in mm⁴`, (value) => { section.iy = value; actions.changed(); }));
    cell(row, numberInput(section.iz, `Section ${section.id} Iz in mm⁴`, (value) => { section.iz = value; actions.changed(); }));
    cell(row, numberInput(section.torsionConstant, `Section ${section.id} J in mm⁴`, (value) => { section.torsionConstant = value; actions.changed(); }));
    cell(row, textInput(section.sourceRevision ?? '', `Section ${section.id} source revision`, (value) => { section.sourceRevision = value; actions.changed(); }));
    actionCell(row, 'sections', index, actions);
  });
}

export function renderLoadTable(model: Frame3DModel, actions: EditorActions): void {
  const nodes = model.nodes.map(({ id }) => [id, id] as [string, string]);
  const loadCases = model.loadCases.map(({ id, name }) => [id, `${id} — ${name}`] as [string, string]);
  renderRows('loads-table', model.nodalLoads.length, (row, index) => {
    const load: NodalLoad = model.nodalLoads[index];
    cell(row, textInput(load.id, `Load ${index + 1} ID`, (value) => { load.id = value; actions.changed(); }));
    cell(row, selectInput(load.loadCaseId, loadCases, `Load ${load.id} load case`, (value) => { load.loadCaseId = value; actions.changed(); }));
    cell(row, selectInput(load.nodeId, nodes, `Load ${load.id} node`, (value) => { load.nodeId = value; actions.changed(); }));
    (['fx', 'fy', 'fz', 'mx', 'my', 'mz'] as const).forEach((key) => cell(row, numberInput(load[key], `Load ${load.id} ${key.toUpperCase()}`, (value) => { load[key] = value; actions.changed(); })));
    actionCell(row, 'nodalLoads', index, actions);
  });
}

export function renderLoadCaseTable(model: Frame3DModel, actions: EditorActions): void {
  renderRows('load-cases-table', model.loadCases.length, (row, index) => {
    const loadCase = model.loadCases[index];
    cell(row, textInput(loadCase.id, `Load case ${index + 1} ID`, (value) => { loadCase.id = value; actions.changed(); }));
    cell(row, textInput(loadCase.name, `Load case ${loadCase.id} name`, (value) => { loadCase.name = value; actions.changed(); }));
    cell(row, textInput(loadCase.category, `Load case ${loadCase.id} category`, (value) => { loadCase.category = value; actions.changed(); }));
    actionCell(row, 'loadCases', index, actions);
  });
}

export function renderCombinationTable(model: Frame3DModel, actions: EditorActions): void {
  renderRows('combinations-table', model.combinations.length, (row, index) => {
    const combination: LoadCombination = model.combinations[index];
    cell(row, textInput(combination.id, `Combination ${index + 1} ID`, (value) => { combination.id = value; actions.changed(); }));
    cell(row, textInput(combination.name, `Combination ${combination.id} name`, (value) => { combination.name = value; actions.changed(); }));
    cell(row, textInput(JSON.stringify(combination.factors), `Combination ${combination.id} factors as JSON`, (value) => {
      try {
        combination.factors = JSON.parse(value) as Record<string, number>;
      } catch {
        combination.factors = { __invalid_json__: Number.NaN };
      }
      actions.changed();
    }));
    actionCell(row, 'combinations', index, actions);
  });
}

export function createDefaultRow(collection: Parameters<EditorActions['duplicate']>[0], model: Frame3DModel): Node3D | Frame3DModel['members'][number] | Material | SectionSnapshot | NodalLoad | Frame3DModel['loadCases'][number] | LoadCombination {
  const suffix = String((model[collection] as Array<unknown>).length + 1);
  if (collection === 'nodes') return { id: `N${suffix}`, x: 0, y: 0, z: 0, restraints: { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false } };
  if (collection === 'members') return { id: `M${suffix}`, startNodeId: model.nodes[0]?.id ?? '', endNodeId: model.nodes[1]?.id ?? model.nodes[0]?.id ?? '', materialId: model.materials[0]?.id ?? '', sectionId: model.sections[0]?.id ?? '', rollAngleRad: 0 };
  if (collection === 'materials') return { id: `MAT${suffix}`, name: 'Custom material', elasticModulus: 210000, poissonRatio: 0.3 };
  if (collection === 'sections') return { id: `SEC${suffix}`, designation: 'Custom section', area: 10000, iy: 8e7, iz: 5e7, torsionConstant: 2e7, sourceRevision: 'User-defined' };
  if (collection === 'nodalLoads') return { id: `L${suffix}`, nodeId: model.nodes[0]?.id ?? '', loadCaseId: model.loadCases[0]?.id ?? '', fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 };
  if (collection === 'loadCases') return { id: `LC${suffix}`, name: `Load case ${suffix}`, category: 'Other' };
  return { id: `COMB${suffix}`, name: `Combination ${suffix}`, factors: Object.fromEntries(model.loadCases.map(({ id }) => [id, 1])) };
}
