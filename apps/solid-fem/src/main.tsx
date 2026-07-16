import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createCadFEMProject,
  type CadFEMProject,
  type JobManifest
} from '../../../packages/cad-fem-schema';
import { validateCadFEMProject } from '../../../packages/cad-fem-validation';
import { createProject, queueMesh, queueSolve } from './api/client';
import { Viewport } from './components/Viewport';
import './styles.css';

function demoProject(): CadFEMProject {
  const project = createCadFEMProject();
  const document = project.partDocuments[0];
  const sketchId = crypto.randomUUID();
  const featureId = crypto.randomUUID();
  const bodyId = crypto.randomUUID();
  document.sketches.push({
    id: sketchId,
    name: 'Base sketch',
    plane: { type: 'principal', plane: 'XY', offset: 0 },
    points: [
      { id: 'p1', x: -60, y: -30 },
      { id: 'p2', x: 60, y: -30 },
      { id: 'p3', x: 60, y: 30 },
      { id: 'p4', x: -60, y: 30 }
    ],
    entities: [
      { id: 'l1', type: 'line', startPointId: 'p1', endPointId: 'p2', construction: false },
      { id: 'l2', type: 'line', startPointId: 'p2', endPointId: 'p3', construction: false },
      { id: 'l3', type: 'line', startPointId: 'p3', endPointId: 'p4', construction: false },
      { id: 'l4', type: 'line', startPointId: 'p4', endPointId: 'p1', construction: false }
    ],
    constraints: [],
    solverState: 'underConstrained',
    degreesOfFreedom: 8
  });
  document.features.push(
    { id: crypto.randomUUID(), name: 'Base sketch', type: 'sketch', sketchId, suppressed: false },
    { id: featureId, name: 'Extrude 1', type: 'extrude', sketchId, distance: 40, direction: 'symmetric', operation: 'newBody', targetBodyIds: [], suppressed: false }
  );
  document.bodies.push({ id: bodyId, name: 'Body 1', sourceFeatureId: featureId, materialId: project.materials[0].id, visible: true, topologyRevision: 1 });
  document.geometryRevision = 1;
  project.studies[0].geometryRevision = 1;
  project.metadata.name = 'Cantilever contact study';
  return project;
}

function App() {
  const [project, setProject] = useState(demoProject);
  const [activeTree, setActiveTree] = useState<'model' | 'study' | 'results'>('model');
  const [selected, setSelected] = useState('Extrude 1');
  const [showMesh, setShowMesh] = useState(false);
  const [showDeformed, setShowDeformed] = useState(false);
  const [status, setStatus] = useState('Local project — not saved');
  const [job, setJob] = useState<JobManifest | null>(null);
  const report = useMemo(() => validateCadFEMProject(project), [project]);
  const study = project.studies[0];

  const updateMaterial = (key: 'elasticModulus' | 'poissonRatio', value: number) => {
    setProject((current) => {
      const next = structuredClone(current);
      next.materials[0][key] = value;
      next.metadata.updatedAt = new Date().toISOString();
      return next;
    });
  };

  const save = async () => {
    setStatus('Saving project…');
    try {
      const response = await createProject(project);
      setProject(response.project);
      setStatus(`Saved revision ${response.project.revision}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const submit = async (kind: 'mesh' | 'solve') => {
    if (!report.valid) {
      setStatus('Resolve validation errors before submitting a native job.');
      return;
    }
    setStatus(kind === 'mesh' ? 'Queueing mesh job…' : 'Queueing solve job…');
    try {
      const response = kind === 'mesh'
        ? await queueMesh(project, study, crypto.randomUUID())
        : await queueSolve(project, study, crypto.randomUUID());
      setJob(response.job);
      setStatus(`${response.job.kind} job ${response.job.stage}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="workbench">
      <header className="appbar">
        <a className="brand" href="/frame3d/"><span className="mark">BC</span><span>Solid CAD/FEM</span></a>
        <div className="document-title"><strong>{project.metadata.name}</strong><span>Beta · revision {project.revision}</span></div>
        <div className="app-actions">
          <button type="button" onClick={save}>Save</button>
          <a href="/frame3d/frame/">Frame analysis</a>
        </div>
      </header>

      <div className="commandbar">
        <div className="command-group"><span>Sketch</span><button type="button">Create sketch</button><button type="button">Constraint</button></div>
        <div className="command-group"><span>Features</span><button type="button">Extrude</button><button type="button">Revolve</button><button type="button">Hole</button><button type="button">Fillet</button><button type="button">Pattern</button></div>
        <div className="command-group"><span>Assembly</span><button type="button">Insert part</button><button type="button">Mate</button><button type="button">Contact pair</button></div>
        <div className="command-group"><span>Analysis</span><button type="button" onClick={() => void submit('mesh')}>Generate mesh</button><button className="primary" type="button" onClick={() => void submit('solve')}>Run study</button></div>
      </div>

      <aside className="tree-panel">
        <div className="tree-tabs">
          {(['model', 'study', 'results'] as const).map((tab) => <button className={activeTree === tab ? 'active' : ''} type="button" onClick={() => setActiveTree(tab)} key={tab}>{tab}</button>)}
        </div>
        {activeTree === 'model' && <div className="tree">
          <TreeRow label={project.partDocuments[0].name} icon="◫" selected={selected === project.partDocuments[0].name} onSelect={setSelected} />
          <div className="tree-indent">
            <TreeRow label="Base sketch" icon="⌗" selected={selected === 'Base sketch'} onSelect={setSelected} />
            <TreeRow label="Extrude 1" icon="▣" selected={selected === 'Extrude 1'} onSelect={setSelected} />
            <TreeRow label="Body 1" icon="◆" selected={selected === 'Body 1'} onSelect={setSelected} />
          </div>
          <TreeRow label={project.assembly.name} icon="⌘" selected={selected === project.assembly.name} onSelect={setSelected} />
        </div>}
        {activeTree === 'study' && <div className="tree">
          <TreeRow label={study.name} icon="Σ" selected={selected === study.name} onSelect={setSelected} />
          <div className="tree-indent">
            <TreeRow label="Materials" icon="M" selected={selected === 'Materials'} onSelect={setSelected} />
            <TreeRow label="Contacts" icon="⇆" selected={selected === 'Contacts'} onSelect={setSelected} />
            <TreeRow label="Supports" icon="⌂" selected={selected === 'Supports'} onSelect={setSelected} />
            <TreeRow label="Loads" icon="↓" selected={selected === 'Loads'} onSelect={setSelected} />
            <TreeRow label="Mesh" icon="△" selected={selected === 'Mesh'} onSelect={setSelected} />
          </div>
        </div>}
        {activeTree === 'results' && <div className="empty-tree">{job?.stage === 'complete' ? 'Result fields available.' : 'No completed native solution.'}</div>}
        <div className="tree-footer"><span className={report.valid ? 'valid' : 'invalid'}>{report.valid ? 'Model valid' : `${report.errors.length} validation errors`}</span></div>
      </aside>

      <main className="viewport-panel">
        <div className="viewport-tools">
          <button className={!showMesh && !showDeformed ? 'active' : ''} type="button" onClick={() => { setShowMesh(false); setShowDeformed(false); }}>Shaded</button>
          <button className={showMesh ? 'active' : ''} type="button" onClick={() => { setShowMesh((value) => !value); setShowDeformed(false); }}>Mesh</button>
          <button className={showDeformed ? 'active' : ''} type="button" onClick={() => { setShowDeformed((value) => !value); setShowMesh(false); }}>Deformed preview</button>
          <span>Cached tessellation preview · mm</span>
        </div>
        <Viewport width={120} height={60} showMesh={showMesh} showDeformed={showDeformed} />
        <div className="view-notice">Browser geometry is visualisation only. CAD regeneration, meshing and solution are authoritative only when returned by the native service.</div>
      </main>

      <aside className="properties-panel">
        <div className="panel-heading"><span>Properties</span><strong>{selected}</strong></div>
        <section>
          <h3>Material</h3>
          <label>Name<input value={project.materials[0].name} readOnly /></label>
          <label>Elastic modulus [N/mm²]<input type="number" value={project.materials[0].elasticModulus} onChange={(event) => updateMaterial('elasticModulus', Number(event.target.value))} /></label>
          <label>Poisson ratio<input type="number" step="0.01" value={project.materials[0].poissonRatio} onChange={(event) => updateMaterial('poissonRatio', Number(event.target.value))} /></label>
        </section>
        <section>
          <h3>Mesh</h3>
          <label>Element order<select value={study.mesh.elementOrder} onChange={(event) => setProject((current) => { const next = structuredClone(current); next.studies[0].mesh.elementOrder = Number(event.target.value) as 1 | 2; return next; })}><option value="2">Quadratic tetrahedra</option><option value="1">Linear preview only</option></select></label>
          <label>Global size [mm]<input type="number" value={study.mesh.globalSize} onChange={(event) => setProject((current) => { const next = structuredClone(current); next.studies[0].mesh.globalSize = Number(event.target.value); return next; })} /></label>
        </section>
        <section className="diagnostics">
          <h3>Diagnostics</h3>
          {[...report.errors, ...report.warnings].slice(0, 6).map((item) => <p className={item.severity} key={`${item.code}-${item.message}`}>{item.message}</p>)}
          {report.errors.length === 0 && report.warnings.length === 0 && <p className="info">No model diagnostics.</p>}
        </section>
      </aside>

      <footer className="statusbar">
        <span>{status}</span>
        <span>{job ? `Job ${job.id.slice(0, 8)} · ${job.stage} · ${Math.round(job.progress * 100)}%` : 'No native job submitted'}</span>
        <strong>Results require independent verification.</strong>
      </footer>
    </div>
  );
}

function TreeRow({ label, icon, selected, onSelect }: { label: string; icon: string; selected: boolean; onSelect: (value: string) => void }) {
  return <button type="button" className={`tree-row ${selected ? 'selected' : ''}`} onClick={() => onSelect(label)}><span>{icon}</span><span>{label}</span></button>;
}

createRoot(document.querySelector<HTMLDivElement>('#root')!).render(<StrictMode><App /></StrictMode>);
