import type { Frame3DDisplayUnits, FrameResult } from '../../../../packages/frame3d-schema';
import { displayForce, displayLength, displayMoment, forceUnit, formatNumber, lengthUnit, momentUnit } from '../../../../packages/frame3d-units';
import { clear } from './dom';

interface Column<T> {
  key: string;
  label: string;
  value: (row: T) => string | number;
}

const sorts = new Map<string, { key: string; direction: 1 | -1 }>();

function resultTable<T>(id: string, rows: T[], columns: Column<T>[]): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'table-scroll result-table';
  const table = document.createElement('table');
  const head = table.createTHead().insertRow();
  const body = table.createTBody();
  const current = sorts.get(id) ?? { key: columns[0].key, direction: 1 as const };
  columns.forEach((column) => {
    const th = document.createElement('th');
    th.scope = 'col';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort-button';
    button.textContent = `${column.label}${current.key === column.key ? (current.direction === 1 ? ' ↑' : ' ↓') : ''}`;
    button.addEventListener('click', () => {
      sorts.set(id, { key: column.key, direction: current.key === column.key ? (current.direction === 1 ? -1 : 1) : 1 });
      const event = new CustomEvent('frame3d-sort-results');
      document.dispatchEvent(event);
    });
    th.append(button);
    head.append(th);
  });
  const column = columns.find(({ key }) => key === current.key) ?? columns[0];
  const sorted = [...rows].sort((a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * current.direction;
    return String(left).localeCompare(String(right)) * current.direction;
  });
  sorted.forEach((row) => {
    const tr = body.insertRow();
    columns.forEach(({ value }) => {
      const td = tr.insertCell();
      const result = value(row);
      td.textContent = typeof result === 'number' ? formatNumber(result) : result;
    });
  });
  wrapper.append(table);
  return wrapper;
}

function heading(text: string): HTMLHeadingElement {
  const value = document.createElement('h3');
  value.textContent = text;
  return value;
}

function summaryItem(label: string, value: string): HTMLElement {
  const item = document.createElement('div');
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value;
  item.append(dt, dd);
  return item;
}

export function renderResults(host: HTMLElement, result: FrameResult | null, units: Frame3DDisplayUnits): void {
  clear(host);
  if (!result) {
    const empty = document.createElement('p');
    empty.className = 'empty-result';
    empty.textContent = 'Run an analysis to populate calculated output.';
    host.append(empty);
    return;
  }
  const summary = document.createElement('dl');
  summary.className = 'result-summary';
  summary.append(
    summaryItem('Maximum translation', `${formatNumber(displayLength(result.maximumDisplacementMagnitude, units))} ${lengthUnit(units)}`),
    summaryItem('Normalised equilibrium residual', formatNumber(result.equilibrium.normalisedResidual)),
    summaryItem('Solver', `${result.metadata.solverVersion} / ${result.metadata.numericalLibrary}`),
    summaryItem('Analysis', `${result.metadata.analysisSelection.type}: ${result.metadata.analysisSelection.id}`)
  );
  host.append(summary);

  host.append(heading('Nodal displacements'));
  host.append(resultTable('nodes', result.nodes, [
    { key: 'node', label: 'Node', value: (row) => row.nodeId },
    { key: 'ux', label: `UX [${lengthUnit(units)}]`, value: (row) => displayLength(row.translations[0], units) },
    { key: 'uy', label: `UY [${lengthUnit(units)}]`, value: (row) => displayLength(row.translations[1], units) },
    { key: 'uz', label: `UZ [${lengthUnit(units)}]`, value: (row) => displayLength(row.translations[2], units) },
    { key: 'rx', label: 'RX [rad]', value: (row) => row.rotations[0] },
    { key: 'ry', label: 'RY [rad]', value: (row) => row.rotations[1] },
    { key: 'rz', label: 'RZ [rad]', value: (row) => row.rotations[2] }
  ]));

  host.append(heading('Support reactions'));
  host.append(resultTable('reactions', result.reactions, [
    { key: 'node', label: 'Node', value: (row) => row.nodeId },
    { key: 'fx', label: `FX [${forceUnit(units)}]`, value: (row) => displayForce(row.forces[0], units) },
    { key: 'fy', label: `FY [${forceUnit(units)}]`, value: (row) => displayForce(row.forces[1], units) },
    { key: 'fz', label: `FZ [${forceUnit(units)}]`, value: (row) => displayForce(row.forces[2], units) },
    { key: 'mx', label: `MX [${momentUnit(units)}]`, value: (row) => displayMoment(row.moments[0], units) },
    { key: 'my', label: `MY [${momentUnit(units)}]`, value: (row) => displayMoment(row.moments[1], units) },
    { key: 'mz', label: `MZ [${momentUnit(units)}]`, value: (row) => displayMoment(row.moments[2], units) }
  ]));

  host.append(heading('Member local end forces'));
  const forceLabels = ['N', 'Vy', 'Vz'] as const;
  const momentLabels = ['T', 'My', 'Mz'] as const;
  host.append(resultTable('members', result.members, [
    { key: 'member', label: 'Member', value: (row) => row.memberId },
    ...forceLabels.map((label, index) => ({ key: `s${label}`, label: `Start ${label} [${forceUnit(units)}]`, value: (row: FrameResult['members'][number]) => displayForce(row.startForces[index], units) })),
    ...momentLabels.map((label, index) => ({ key: `s${label}`, label: `Start ${label} [${momentUnit(units)}]`, value: (row: FrameResult['members'][number]) => displayMoment(row.startForces[index + 3], units) })),
    ...forceLabels.map((label, index) => ({ key: `e${label}`, label: `End ${label} [${forceUnit(units)}]`, value: (row: FrameResult['members'][number]) => displayForce(row.endForces[index], units) })),
    ...momentLabels.map((label, index) => ({ key: `e${label}`, label: `End ${label} [${momentUnit(units)}]`, value: (row: FrameResult['members'][number]) => displayMoment(row.endForces[index + 3], units) }))
  ]));

  host.append(heading('Global equilibrium'));
  const equilibrium = document.createElement('dl');
  equilibrium.className = 'equilibrium-grid';
  equilibrium.append(
    summaryItem('Force residual [N]', result.equilibrium.forceResidual.map((value) => formatNumber(value)).join(', ')),
    summaryItem('Moment residual [N·mm]', result.equilibrium.momentResidual.map((value) => formatNumber(value)).join(', ')),
    summaryItem('Normalised force residual', formatNumber(result.equilibrium.normalisedForceResidual)),
    summaryItem('Normalised moment residual', formatNumber(result.equilibrium.normalisedMomentResidual)),
    summaryItem('Degrees of freedom', `${result.metadata.dofCount} total / ${result.metadata.freeDofCount} free / ${result.metadata.restrainedDofCount} restrained`),
    summaryItem('Condition estimate', result.metadata.conditionEstimate === null ? 'Not applicable' : formatNumber(result.metadata.conditionEstimate))
  );
  host.append(equilibrium);
}
