import './styles.css';
import {
  createEmptyModel,
  type Frame3DModel,
  type Frame3DSectionLibraryItem,
  type SolverWorkerMessage
} from '../../../packages/frame3d-schema';
import { DEFAULT_FRAME3D_EXAMPLE, FRAME3D_EXAMPLES } from '../../../packages/frame3d-schema/examples';
import { validateFrameModel } from '../../../packages/frame3d-validation';
import { parseModel, serialiseModel } from './model/serialise';
import { state } from './state/store';
import { byId, clear, setMessages } from './ui/dom';
import {
  createDefaultRow,
  renderCombinationTable,
  renderLoadCaseTable,
  renderLoadTable,
  renderMaterialTable,
  renderMemberTable,
  renderNodeTable,
  renderSectionTable,
  type EditorActions
} from './ui/editor-tables';
import { renderResults } from './ui/results';

const app = document.querySelector<HTMLDivElement>('#app')!;
const colourScheme = matchMedia('(prefers-color-scheme: dark)');
const FRAME3D_API_BASE = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? ''
  : 'https://beam-calculator-api.harrynixon98.workers.dev';

function apiUrl(path: `/api/${string}`): string {
  return `${FRAME3D_API_BASE}${path}`;
}

function applyTheme(): void {
  document.documentElement.dataset.theme = colourScheme.matches ? 'dark' : 'light';
}

applyTheme();
colourScheme.addEventListener?.('change', applyTheme);

app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/frame3d/"><span class="mark">BC</span><span>Beam Calculator Studio</span></a>
    <div class="product"><strong>3D Frame Analysis</strong><span>Foundation</span></div>
    <a class="beam-link" href="/frame3d/solid/">Solid CAD/FEM</a>
  </header>
  <main>
    <div class="foundation-notice">Foundation release: linear-elastic 3D frame analysis using beam elements. Results must be independently verified before engineering use.</div>
    <section class="section-card project-card">
      <div class="section-heading"><div><span class="eyebrow">Project</span><h1>Frame model data</h1></div><span id="model-revision" class="revision"></span></div>
      <div class="project-grid">
        <label>Project name<input id="project-name" type="text"></label>
        <label>Model name<input id="model-name" type="text"></label>
        <label>Engineer<input id="engineer-name" type="text"></label>
        <label>Length display<select id="length-units"><option value="mm">mm</option><option value="m">m</option></select></label>
        <label>Force display<select id="force-units"><option value="N">N</option><option value="kN">kN</option></select></label>
        <label>Moment display<select id="moment-units"><option value="N·mm">N·mm</option><option value="kN·m">kN·m</option></select></label>
      </div>
      <div class="toolbar wrap">
        <button id="new-model" type="button">New model</button>
        <label class="inline-label">Example<select id="example-select"></select></label>
        <button id="load-example" type="button">Load example</button>
        <button id="import-model" type="button">Import JSON</button>
        <input id="import-file" type="file" accept="application/json,.json" hidden>
        <button id="export-model" type="button">Export JSON</button>
      </div>
      <div class="example-notes">
        <p><strong>Geometry and supports:</strong> <span id="example-description"></span></p>
        <p><strong>Expected behaviour:</strong> <span id="example-behaviour"></span></p>
        <p><strong>Benchmark:</strong> <span id="example-source"></span></p>
      </div>
    </section>

    <div class="editor-layout">
      <div class="editor-stack">
        <section class="section-card"><div class="section-heading"><div><span class="eyebrow">Geometry</span><h2>Nodes</h2></div><button data-add="nodes" type="button">Add node</button></div>
          <div class="table-scroll"><table id="nodes-table"><thead><tr><th>ID</th><th>X [mm]</th><th>Y [mm]</th><th>Z [mm]</th><th>UX</th><th>UY</th><th>UZ</th><th>RX</th><th>RY</th><th>RZ</th><th>Actions</th></tr></thead><tbody></tbody></table></div>
        </section>
        <section class="section-card"><div class="section-heading"><div><span class="eyebrow">Geometry</span><h2>Members</h2></div><button data-add="members" type="button">Add member</button></div>
          <p class="section-help">Local X runs start to end. Reference X/Y/Z is optional; the documented automatic rule is used when blank.</p>
          <div class="table-scroll"><table id="members-table"><thead><tr><th>ID</th><th>Start</th><th>End</th><th>Material</th><th>Section</th><th>Roll [rad]</th><th>Ref X</th><th>Ref Y</th><th>Ref Z</th><th>Actions</th></tr></thead><tbody></tbody></table></div>
        </section>
        <section class="section-card"><div class="section-heading"><div><span class="eyebrow">Properties</span><h2>Materials</h2></div><button data-add="materials" type="button">Add material</button></div>
          <p class="section-help">E and G use N/mm². Leave G blank to derive G = E / [2(1 + ν)].</p>
          <div class="table-scroll"><table id="materials-table"><thead><tr><th>ID</th><th>Name</th><th>E [N/mm²]</th><th>ν</th><th>G [N/mm²]</th><th>Actions</th></tr></thead><tbody></tbody></table></div>
        </section>
        <section class="section-card"><div class="section-heading"><div><span class="eyebrow">Properties</span><h2>Section snapshots</h2></div><button data-add="sections" type="button">Add custom section</button></div>
          <p class="section-help">The saved model stores these analysis properties. Missing catalogue values are never inferred.</p>
          <div class="library-controls"><button id="load-section-library" type="button">Load existing section library</button><select id="section-library-select" aria-label="Available Frame3D sections"><option value="">Load the library first</option></select><button id="add-library-section" type="button" disabled>Add property snapshot</button></div>
          <p id="section-library-status" class="section-help"></p>
          <div class="table-scroll"><table id="sections-table"><thead><tr><th>ID</th><th>Designation</th><th>A [mm²]</th><th>Iy [mm⁴]</th><th>Iz [mm⁴]</th><th>J [mm⁴]</th><th>Source/revision</th><th>Actions</th></tr></thead><tbody></tbody></table></div>
        </section>
        <section class="section-card"><div class="section-heading"><div><span class="eyebrow">Loading</span><h2>Nodal loads</h2></div><button data-add="nodalLoads" type="button">Add nodal load</button></div>
          <div class="table-scroll"><table id="loads-table"><thead><tr><th>ID</th><th>Load case</th><th>Node</th><th>FX [N]</th><th>FY [N]</th><th>FZ [N]</th><th>MX [N·mm]</th><th>MY [N·mm]</th><th>MZ [N·mm]</th><th>Actions</th></tr></thead><tbody></tbody></table></div>
        </section>
        <section class="section-card"><div class="section-heading"><div><span class="eyebrow">Loading</span><h2>Load cases</h2></div><button data-add="loadCases" type="button">Add load case</button></div>
          <div class="table-scroll"><table id="load-cases-table"><thead><tr><th>ID</th><th>Name</th><th>Category</th><th>Actions</th></tr></thead><tbody></tbody></table></div>
        </section>
        <section class="section-card"><div class="section-heading"><div><span class="eyebrow">Loading</span><h2>Linear combinations</h2></div><button data-add="combinations" type="button">Add combination</button></div>
          <p class="section-help">Factors use JSON keyed by load-case ID, for example {"LC1":1.0,"LC2":1.5}.</p>
          <div class="table-scroll"><table id="combinations-table"><thead><tr><th>ID</th><th>Name</th><th>Factors by load-case ID</th><th>Actions</th></tr></thead><tbody></tbody></table></div>
        </section>
      </div>

      <aside class="analysis-column">
        <section class="section-card sticky-analysis">
          <span class="eyebrow">Analysis</span><h2>Linear static solution</h2>
          <label>Analysis selection<select id="analysis-selection"></select></label>
          <div class="analysis-actions"><button id="validate-model" type="button">Validate model</button><button id="run-analysis" class="primary" type="button">Run analysis</button><button id="cancel-analysis" type="button" disabled>Cancel</button></div>
          <dl class="solver-state"><div><dt>Solver state</dt><dd id="solver-state">Ready</dd></div><div><dt>Model revision</dt><dd id="solver-revision">1</dd></div></dl>
          <h3>Errors</h3><div id="validation-errors" class="message-box errors"></div>
          <h3>Warnings</h3><div id="validation-warnings" class="message-box warnings"></div>
          <div class="planned"><strong>Planned</strong><span>Graphical modelling, member loads, end releases, springs, second-order analysis and design-code checks.</span></div>
        </section>
      </aside>
    </div>

    <section class="section-card results-card">
      <div class="section-heading"><div><span class="eyebrow">Calculated output</span><h2>Results</h2></div><span id="result-selection" class="revision">Not analysed</span></div>
      <div id="results"></div>
    </section>
  </main>
  <footer><span>All analysis is performed locally in the browser by Rust/WebAssembly.</span><a href="/privacy/">Privacy</a></footer>
`;

type EditableCollection = Parameters<EditorActions['duplicate']>[0];
let sectionLibrary: Frame3DSectionLibraryItem[] = [];

function markChanged(): void {
  state.modelRevision += 1;
  state.result = null;
  state.analysisErrors = [];
  state.analysisWarnings = [];
  if (state.worker) cancelAnalysis();
  state.analysisState = 'Ready';
  renderAll();
}

const editorActions: EditorActions = {
  changed: markChanged,
  duplicate: (collection, index) => {
    const values = state.model[collection] as Array<unknown>;
    const copy = structuredClone(values[index]) as { id?: string };
    if (copy?.id) copy.id = `${copy.id}_COPY`;
    values.splice(index + 1, 0, copy);
    markChanged();
  },
  remove: (collection, index) => {
    (state.model[collection] as Array<unknown>).splice(index, 1);
    markChanged();
  }
};

function addRow(collection: EditableCollection): void {
  const row = createDefaultRow(collection, state.model);
  (state.model[collection] as Array<unknown>).push(row);
  markChanged();
}

function renderProject(): void {
  byId<HTMLInputElement>('project-name').value = state.model.metadata.projectName;
  byId<HTMLInputElement>('model-name').value = state.model.metadata.modelName;
  byId<HTMLInputElement>('engineer-name').value = state.model.metadata.engineer;
  byId<HTMLSelectElement>('length-units').value = state.model.displayUnits.length;
  byId<HTMLSelectElement>('force-units').value = state.model.displayUnits.force;
  byId<HTMLSelectElement>('moment-units').value = state.model.displayUnits.moment;
  byId('model-revision').textContent = `Schema ${state.model.schemaVersion} / revision ${state.modelRevision}`;
  byId('example-description').textContent = state.model.metadata.description || 'User-defined model.';
  byId('example-behaviour').textContent = state.model.metadata.expectedBehaviour || 'Review the model and expected structural response before analysis.';
  byId('example-source').textContent = state.model.metadata.benchmarkSource || 'No benchmark stated.';
}

function renderAnalysisSelection(): void {
  const select = byId<HTMLSelectElement>('analysis-selection');
  clear(select);
  state.model.loadCases.forEach(({ id, name }) => {
    const option = document.createElement('option');
    option.value = `loadCase:${id}`;
    option.textContent = `Load case — ${id}: ${name}`;
    select.append(option);
  });
  state.model.combinations.forEach(({ id, name }) => {
    const option = document.createElement('option');
    option.value = `combination:${id}`;
    option.textContent = `Combination — ${id}: ${name}`;
    select.append(option);
  });
  select.value = `${state.model.analysisSettings.selection.type}:${state.model.analysisSettings.selection.id}`;
}

function validateAndRender(): ReturnType<typeof validateFrameModel> {
  const report = validateFrameModel(state.model);
  setMessages(byId('validation-errors'), [...report.errors, ...state.analysisErrors], 'No validation errors.');
  setMessages(byId('validation-warnings'), [...report.warnings, ...state.analysisWarnings], 'No validation warnings.');
  return report;
}

function renderAll(): void {
  renderProject();
  renderNodeTable(state.model, editorActions);
  renderMemberTable(state.model, editorActions);
  renderMaterialTable(state.model, editorActions);
  renderSectionTable(state.model, editorActions);
  renderLoadTable(state.model, editorActions);
  renderLoadCaseTable(state.model, editorActions);
  renderCombinationTable(state.model, editorActions);
  renderAnalysisSelection();
  validateAndRender();
  byId('solver-state').textContent = state.analysisState;
  byId('solver-revision').textContent = String(state.modelRevision);
  byId<HTMLButtonElement>('cancel-analysis').disabled = !state.worker;
  byId<HTMLButtonElement>('run-analysis').disabled = Boolean(state.worker);
  byId('result-selection').textContent = state.result
    ? `${state.result.metadata.analysisSelection.type}: ${state.result.metadata.analysisSelection.id}`
    : 'Not analysed';
  renderResults(byId('results'), state.result, state.model.displayUnits);
}

function loadModel(model: Frame3DModel): void {
  if (state.worker) cancelAnalysis();
  state.model = structuredClone(model);
  state.modelRevision += 1;
  state.result = null;
  state.analysisState = 'Ready';
  state.analysisErrors = [];
  state.analysisWarnings = [];
  renderAll();
}

function downloadModel(): void {
  const blob = new Blob([serialiseModel(state.model)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${state.model.metadata.modelName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'frame3d-model'}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function cancelAnalysis(): void {
  state.worker?.terminate();
  state.worker = null;
  state.requestId += 1;
  state.analysisState = 'Cancelled';
  renderAll();
}

function runAnalysis(): void {
  const report = validateAndRender();
  if (!report.valid) {
    state.analysisState = 'Failed';
    renderAll();
    return;
  }
  state.analysisErrors = [];
  state.analysisWarnings = [];
  state.requestId += 1;
  const requestId = state.requestId;
  const modelRevision = state.modelRevision;
  state.analysisState = 'Validating';
  state.worker = new Worker(new URL('./solver-worker.ts', import.meta.url), { type: 'module' });
  state.worker.onmessage = (event: MessageEvent<SolverWorkerMessage>) => {
    const message = event.data;
    if (message.requestId !== state.requestId || message.modelRevision !== state.modelRevision) return;
    if (message.type === 'progress') {
      state.analysisState = message.state;
      byId('solver-state').textContent = message.state;
      return;
    }
    state.worker?.terminate();
    state.worker = null;
    if (message.response.status === 'ok') {
      state.result = message.response;
      state.analysisState = 'Complete';
      state.analysisErrors = message.response.errors;
      state.analysisWarnings = message.response.warnings;
    } else {
      state.result = null;
      state.analysisState = 'Failed';
      state.analysisErrors = [message.response.message, ...message.response.errors];
      state.analysisWarnings = message.response.warnings;
    }
    renderAll();
  };
  state.worker.onerror = (event) => {
    if (requestId !== state.requestId || modelRevision !== state.modelRevision) return;
    state.worker?.terminate();
    state.worker = null;
    state.analysisState = 'Failed';
    state.analysisErrors = [`The Rust/WebAssembly worker failed: ${event.message}`];
    state.analysisWarnings = [];
    renderAll();
  };
  state.worker.postMessage({
    requestId,
    modelRevision,
    model: structuredClone(state.model),
    selection: structuredClone(state.model.analysisSettings.selection)
  });
  renderAll();
}

async function loadSectionLibrary(): Promise<void> {
  const status = byId('section-library-status');
  status.textContent = 'Loading section properties…';
  try {
    const response = await fetch(apiUrl('/api/frame3d/sections'), { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Section service returned ${response.status}.`);
    const body = await response.json() as { sections?: Frame3DSectionLibraryItem[] };
    sectionLibrary = body.sections ?? [];
    const select = byId<HTMLSelectElement>('section-library-select');
    clear(select);
    sectionLibrary.forEach((section, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.disabled = !section.available;
      option.textContent = section.available
        ? `${section.family} ${section.designation}`
        : `${section.family} ${section.designation} — unavailable: ${section.missingProperties.join(', ')}`;
      select.append(option);
    });
    const available = sectionLibrary.filter(({ available }) => available).length;
    status.textContent = `${available} of ${sectionLibrary.length} catalogue sections have A, Iy, Iz and J/It. Unavailable rows identify missing properties.`;
    byId<HTMLButtonElement>('add-library-section').disabled = available === 0;
  } catch (error) {
    status.textContent = `${error instanceof Error ? error.message : String(error)} Use clearly labelled custom properties instead.`;
  }
}

function addLibrarySection(): void {
  const index = Number(byId<HTMLSelectElement>('section-library-select').value);
  const item = sectionLibrary[index];
  if (!item?.available || !item.snapshot) return;
  const snapshot = structuredClone(item.snapshot);
  const existing = new Set(state.model.sections.map(({ id }) => id));
  let id = snapshot.id;
  let suffix = 2;
  while (existing.has(id)) id = `${snapshot.id}-${suffix++}`;
  snapshot.id = id;
  state.model.sections.push(snapshot);
  markChanged();
}

Object.entries(FRAME3D_EXAMPLES).forEach(([id, factory]) => {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = factory().metadata.modelName;
  byId<HTMLSelectElement>('example-select').append(option);
});
byId<HTMLSelectElement>('example-select').value = DEFAULT_FRAME3D_EXAMPLE;

byId<HTMLInputElement>('project-name').addEventListener('change', (event) => { state.model.metadata.projectName = (event.target as HTMLInputElement).value.trim(); markChanged(); });
byId<HTMLInputElement>('model-name').addEventListener('change', (event) => { state.model.metadata.modelName = (event.target as HTMLInputElement).value.trim(); markChanged(); });
byId<HTMLInputElement>('engineer-name').addEventListener('change', (event) => { state.model.metadata.engineer = (event.target as HTMLInputElement).value.trim(); markChanged(); });
byId<HTMLSelectElement>('length-units').addEventListener('change', (event) => { state.model.displayUnits.length = (event.target as HTMLSelectElement).value as 'mm' | 'm'; markChanged(); });
byId<HTMLSelectElement>('force-units').addEventListener('change', (event) => { state.model.displayUnits.force = (event.target as HTMLSelectElement).value as 'N' | 'kN'; markChanged(); });
byId<HTMLSelectElement>('moment-units').addEventListener('change', (event) => { state.model.displayUnits.moment = (event.target as HTMLSelectElement).value as 'N·mm' | 'kN·m'; markChanged(); });
byId<HTMLSelectElement>('analysis-selection').addEventListener('change', (event) => {
  const [type, id] = (event.target as HTMLSelectElement).value.split(':');
  state.model.analysisSettings.selection = { type: type as 'loadCase' | 'combination', id };
  markChanged();
});
document.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((button) => button.addEventListener('click', () => addRow(button.dataset.add as EditableCollection)));
byId('new-model').addEventListener('click', () => loadModel(createEmptyModel()));
byId('load-example').addEventListener('click', () => loadModel(FRAME3D_EXAMPLES[byId<HTMLSelectElement>('example-select').value]()));
byId('export-model').addEventListener('click', downloadModel);
byId('import-model').addEventListener('click', () => byId<HTMLInputElement>('import-file').click());
byId<HTMLInputElement>('import-file').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    loadModel(parseModel(await file.text()));
  } catch (error) {
    state.analysisState = 'Failed';
    state.analysisErrors = [error instanceof Error ? error.message : String(error)];
    state.analysisWarnings = [];
    renderAll();
  } finally {
    input.value = '';
  }
});
byId('validate-model').addEventListener('click', () => {
  state.analysisErrors = [];
  state.analysisWarnings = [];
  state.analysisState = validateAndRender().valid ? 'Ready' : 'Failed';
  renderAll();
});
byId('run-analysis').addEventListener('click', runAnalysis);
byId('cancel-analysis').addEventListener('click', cancelAnalysis);
byId('load-section-library').addEventListener('click', () => { void loadSectionLibrary(); });
byId('add-library-section').addEventListener('click', addLibrarySection);
document.addEventListener('frame3d-sort-results', () => renderResults(byId('results'), state.result, state.model.displayUnits));

renderAll();
