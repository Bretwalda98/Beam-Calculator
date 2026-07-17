import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createCadFEMProject,
  type CadFEMProject,
  type CatalogueSectionSnapshot,
  type JobManifest,
  type PartFeature
} from '../../../packages/cad-fem-schema';
import { validateCadFEMProject } from '../../../packages/cad-fem-validation';
import {
  applyCommand,
  createProject,
  getCatalogueSectionProfile,
  getProject,
  listCatalogueSections,
  queueMesh,
  queueSolve,
  type CatalogueSectionListItem
} from './api/client';
import { Viewport } from './components/Viewport';
import './styles.css';

function newProject(): CadFEMProject {
  const project = createCadFEMProject();
  project.metadata.name = 'EC3 catalogue section study';
  return project;
}

function catalogueFeatures(project: CadFEMProject) {
  return project.partDocuments.flatMap(({ features }) => features.filter(
    (feature): feature is Extract<PartFeature, { type: 'catalogueExtrusion' }> => feature.type === 'catalogueExtrusion'
  ));
}

function App() {
  const [project, setProject] = useState(newProject);
  const [persisted, setPersisted] = useState(false);
  const [catalogue, setCatalogue] = useState<CatalogueSectionListItem[]>([]);
  const [catalogueStatus, setCatalogueStatus] = useState('Loading the Beam EC3 section catalogue…');
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState('All');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [profile, setProfile] = useState<CatalogueSectionSnapshot | null>(null);
  const [memberLength, setMemberLength] = useState(3000);
  const [activeTree, setActiveTree] = useState<'model' | 'study' | 'results'>('model');
  const [selected, setSelected] = useState('Part 1');
  const [wireframe, setWireframe] = useState(false);
  const [status, setStatus] = useState('New local project — select an EC3 section');
  const [job, setJob] = useState<JobManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const report = useMemo(() => validateCadFEMProject(project), [project]);
  const study = project.studies[0];
  const document = project.partDocuments[0];
  const savedCatalogueFeatures = useMemo(() => catalogueFeatures(project), [project]);

  useEffect(() => {
    let active = true;
    void listCatalogueSections().then((sections) => {
      if (!active) return;
      const available = sections.filter(({ solidProfileAvailable }) => solidProfileAvailable);
      setCatalogue(available);
      setCatalogueStatus(`${available.length} source-backed catalogue profiles available`);
      const initial = available.find(({ id }) => id === 'UB|UB 254x146x31') || available[0];
      if (initial) setSelectedSectionId(initial.id);
    }).catch((error: unknown) => {
      if (!active) return;
      setCatalogueStatus(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedSectionId) {
      setProfile(null);
      return;
    }
    let active = true;
    setCatalogueStatus('Loading authoritative section dimensions…');
    void getCatalogueSectionProfile(selectedSectionId).then((nextProfile) => {
      if (!active) return;
      setProfile(nextProfile);
      setSelected(nextProfile.designation);
      setCatalogueStatus(`${catalogue.length} source-backed catalogue profiles available`);
    }).catch((error: unknown) => {
      if (!active) return;
      setProfile(null);
      setCatalogueStatus(error instanceof Error ? error.message : String(error));
    });
    return () => { active = false; };
  }, [catalogue.length, selectedSectionId]);

  const families = useMemo(
    () => ['All', ...new Set(catalogue.map(({ family: sectionFamily }) => sectionFamily))],
    [catalogue]
  );
  const filteredCatalogue = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('en-GB');
    return catalogue.filter((section) => (
      (family === 'All' || section.family === family) &&
      (!term || `${section.family} ${section.designation}`.toLocaleLowerCase('en-GB').includes(term))
    ));
  }, [catalogue, family, search]);

  const updateMaterial = (key: 'elasticModulus' | 'poissonRatio', value: number) => {
    setProject((current) => {
      const next = structuredClone(current);
      next.materials[0][key] = value;
      next.metadata.updatedAt = new Date().toISOString();
      return next;
    });
  };

  const addSelectedSection = async () => {
    if (!profile || !Number.isFinite(memberLength) || memberLength <= 0) {
      setStatus('Select a section and enter a positive member length.');
      return;
    }
    setBusy(true);
    setStatus('Saving the project and EC3 section snapshot…');
    try {
      let workingProject = project;
      if (!persisted) {
        const response = await createProject(project);
        workingProject = response.project;
        setPersisted(true);
      }
      const duplicate = catalogueFeatures(workingProject).some((feature) => (
        feature.section.sectionId === profile.sectionId && feature.length === memberLength
      ));
      if (duplicate) {
        setProject(workingProject);
        setStatus(`${profile.designation} × ${memberLength} mm is already in this project.`);
        return;
      }
      if (catalogueFeatures(workingProject).length > 0) {
        setProject(workingProject);
        setStatus('This meshing foundation accepts one section per project. Choose New project before inserting a different section.');
        return;
      }
      const result = await applyCommand(workingProject.id, {
        commandId: crypto.randomUUID(),
        baseRevision: workingProject.revision,
        command: {
          type: 'appendCatalogueExtrusion',
          documentId: workingProject.partDocuments[0].id,
          featureId: crypto.randomUUID(),
          bodyId: crypto.randomUUID(),
          componentId: crypto.randomUUID(),
          sectionId: profile.sectionId,
          length: memberLength,
          name: `${profile.designation} × ${memberLength} mm`
        }
      });
      const refreshed = await getProject(workingProject.id);
      setProject(refreshed.project);
      setSelected(`${profile.designation} × ${memberLength} mm`);
      setStatus(`Section model saved at revision ${result.revision}. ${result.warnings.join(' ')}`.trim());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (kind: 'mesh' | 'solve') => {
    if (kind === 'mesh' && (!persisted || savedCatalogueFeatures.length !== 1)) {
      setStatus('Save exactly one EC3 section model before submitting native meshing.');
      return;
    }
    if (kind === 'solve' && !report.valid) {
      setStatus('Define valid supports and loads before submitting native analysis. No substitute browser solver is used.');
      return;
    }
    setBusy(true);
    setStatus(kind === 'mesh' ? 'Queueing native mesh job…' : 'Queueing native solve job…');
    try {
      const response = kind === 'mesh'
        ? await queueMesh(project, study, crypto.randomUUID())
        : await queueSolve(project, study, crypto.randomUUID());
      setJob(response.job);
      setStatus(`${response.job.kind} job ${response.job.stage}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const meshReady = persisted && savedCatalogueFeatures.length === 1 && !busy;
  const analysisReady = report.valid && persisted && !busy;

  return (
    <div className="workbench">
      <header className="appbar">
        <a className="brand" href="/frame3d/"><span className="mark">BC</span><span>Solid CAD/FEM</span></a>
        <div className="document-title"><strong>{project.metadata.name}</strong><span>Beta · revision {project.revision}</span></div>
        <div className="app-actions">
          <button type="button" disabled={busy} onClick={() => { setProject(newProject()); setPersisted(false); setJob(null); setStatus('New local project — select an EC3 section'); }}>New project</button>
          <button type="button" disabled={busy || !profile} onClick={() => void addSelectedSection()}>Save section model</button>
          <a href="/frame3d/frame/">Frame analysis</a>
        </div>
      </header>

      <div className="commandbar">
        <div className="command-group active-command"><span>EC3 catalogue</span><button type="button" onClick={() => setSelected('Section catalogue')}>Insert section</button></div>
        <div className="command-group"><span>Sketch</span><button type="button" disabled title="Planned for the CAD workbench stage">Create sketch</button><button type="button" disabled title="Planned for the CAD workbench stage">Constraint</button></div>
        <div className="command-group"><span>Features</span><button type="button" disabled>Extrude</button><button type="button" disabled>Revolve</button><button type="button" disabled>Hole</button><button type="button" disabled>Fillet</button></div>
        <div className="command-group"><span>Assembly</span><button type="button" disabled>Insert part</button><button type="button" disabled>Mate</button><button type="button" disabled>Contact pair</button></div>
        <div className="command-group"><span>Analysis</span><button type="button" disabled={!meshReady} onClick={() => void submit('mesh')}>Generate mesh</button><button className="primary" type="button" disabled={!analysisReady} onClick={() => void submit('solve')}>Run study</button></div>
      </div>

      <aside className="tree-panel">
        <div className="tree-tabs">
          {(['model', 'study', 'results'] as const).map((tab) => <button className={activeTree === tab ? 'active' : ''} type="button" onClick={() => setActiveTree(tab)} key={tab}>{tab}</button>)}
        </div>
        {activeTree === 'model' && <div className="tree">
          <TreeRow label={document.name} icon="P" selected={selected === document.name} onSelect={setSelected} />
          <div className="tree-indent">
            {document.features.map((feature) => <TreeRow key={feature.id} label={feature.name} icon="F" selected={selected === feature.name} onSelect={setSelected} />)}
            {document.bodies.map((body) => <TreeRow key={body.id} label={body.name} icon="B" selected={selected === body.name} onSelect={setSelected} />)}
            {!document.features.length && <p className="tree-hint">Choose an EC3 section, set its length, then save the section model.</p>}
          </div>
          <TreeRow label={project.assembly.name} icon="A" selected={selected === project.assembly.name} onSelect={setSelected} />
          <div className="tree-indent">
            {project.assembly.components.map((component) => <TreeRow key={component.id} label={component.name} icon="C" selected={selected === component.name} onSelect={setSelected} />)}
          </div>
        </div>}
        {activeTree === 'study' && <div className="tree">
          <TreeRow label={study.name} icon="Σ" selected={selected === study.name} onSelect={setSelected} />
          <div className="tree-indent">
            <TreeRow label="Materials" icon="M" selected={selected === 'Materials'} onSelect={setSelected} />
            <TreeRow label="Contacts" icon="C" selected={selected === 'Contacts'} onSelect={setSelected} />
            <TreeRow label="Supports" icon="S" selected={selected === 'Supports'} onSelect={setSelected} />
            <TreeRow label="Loads" icon="L" selected={selected === 'Loads'} onSelect={setSelected} />
            <TreeRow label="Mesh" icon="T" selected={selected === 'Mesh'} onSelect={setSelected} />
          </div>
        </div>}
        {activeTree === 'results' && <div className="empty-tree">{job?.stage === 'complete' ? 'Native result fields are available.' : 'No completed native solution.'}</div>}
        <div className="tree-footer"><span className={report.valid ? 'valid' : 'invalid'}>{report.valid ? 'Study ready' : `${report.errors.length} analysis requirements outstanding`}</span></div>
      </aside>

      <main className="viewport-panel">
        <div className="viewport-tools">
          <button className={!wireframe ? 'active' : ''} type="button" onClick={() => setWireframe(false)}>Shaded</button>
          <button className={wireframe ? 'active' : ''} type="button" onClick={() => setWireframe(true)}>Wireframe</button>
          <button type="button" disabled title="Available only after a native mesh job completes">Mesh unavailable</button>
          <span>Catalogue profile preview · mm</span>
        </div>
        <Viewport profile={profile} length={memberLength} wireframe={wireframe} />
        <div className="view-notice">This browser view is a nominal profile preview. OCCT regeneration, radii, meshing and results are authoritative only when returned by the native service.</div>
      </main>

      <aside className="properties-panel">
        <div className="panel-heading"><span>Properties</span><strong>{selected}</strong></div>
        <section className="catalogue-properties">
          <h3>Beam EC3 section</h3>
          <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. UB 254 or RHS" /></label>
          <label>Family<select value={family} onChange={(event) => setFamily(event.target.value)}>{families.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Section<select value={selectedSectionId} onChange={(event) => setSelectedSectionId(event.target.value)}>{filteredCatalogue.map((section) => <option value={section.id} key={section.id}>{section.designation} · {section.mass_kg_m} kg/m</option>)}</select></label>
          <label>Member length [mm]<input type="number" min="1" step="10" value={memberLength} onChange={(event) => setMemberLength(Number(event.target.value))} /></label>
          <button className="wide-action" type="button" disabled={busy || !profile} onClick={() => void addSelectedSection()}>Add section to project</button>
          <p className="catalogue-status">{catalogueStatus}</p>
          {profile && <dl className="section-dimensions">
            <div><dt>Depth</dt><dd>{profile.dimensions.height} mm</dd></div>
            <div><dt>Width</dt><dd>{profile.dimensions.width} mm</dd></div>
            <div><dt>Area</dt><dd>{profile.properties.area.toLocaleString('en-GB')} mm²</dd></div>
            <div><dt>Mass</dt><dd>{profile.properties.massPerLength ?? '—'} kg/m</dd></div>
            <div><dt>{profile.kind === 'rhs' ? 'Wall' : 'Web'}</dt><dd>{profile.kind === 'rhs' ? profile.dimensions.wallThickness : profile.dimensions.webThickness} mm</dd></div>
            <div><dt>{profile.kind === 'rhs' ? 'Outer radius' : 'Flange'}</dt><dd>{profile.kind === 'rhs' ? profile.dimensions.rootRadius : profile.dimensions.flangeThickness} mm</dd></div>
          </dl>}
          {profile && <p className="catalogue-source">Source: <a href={profile.source.url} target="_blank" rel="noreferrer">{profile.source.title}</a></p>}
        </section>
        <section>
          <h3>Material</h3>
          <label>Name<input value={project.materials[0].name} readOnly /></label>
          <label>Elastic modulus [N/mm²]<input type="number" value={project.materials[0].elasticModulus} onChange={(event) => updateMaterial('elasticModulus', Number(event.target.value))} /></label>
          <label>Poisson ratio<input type="number" step="0.01" value={project.materials[0].poissonRatio} onChange={(event) => updateMaterial('poissonRatio', Number(event.target.value))} /></label>
        </section>
        <section>
          <h3>Mesh settings</h3>
          <label>Element order<select value={study.mesh.elementOrder} onChange={(event) => setProject((current) => { const next = structuredClone(current); next.studies[0].mesh.elementOrder = Number(event.target.value) as 1 | 2; return next; })}><option value="2">Quadratic tetrahedra</option><option value="1">Linear diagnostic only</option></select></label>
          <label>Global size [mm]<input type="number" value={study.mesh.globalSize} onChange={(event) => setProject((current) => { const next = structuredClone(current); next.studies[0].mesh.globalSize = Number(event.target.value); return next; })} /></label>
        </section>
        <section className="diagnostics">
          <h3>Analysis readiness</h3>
          {[...report.errors, ...report.warnings].slice(0, 6).map((item) => <p className={item.severity} key={`${item.code}-${item.message}`}>{item.message}</p>)}
          {report.errors.length === 0 && report.warnings.length === 0 && <p className="info">No model diagnostics.</p>}
        </section>
      </aside>

      <footer className="statusbar">
        <span>{status}</span>
        <span>{job ? `Job ${job.id.slice(0, 8)} · ${job.stage} · ${Math.round(job.progress * 100)}%` : `${savedCatalogueFeatures.length} saved catalogue section${savedCatalogueFeatures.length === 1 ? '' : 's'}`}</span>
        <strong>Beta · independently verify engineering results.</strong>
      </footer>
    </div>
  );
}

function TreeRow({ label, icon, selected, onSelect }: { label: string; icon: string; selected: boolean; onSelect: (value: string) => void }) {
  return <button type="button" className={`tree-row ${selected ? 'selected' : ''}`} onClick={() => onSelect(label)}><span aria-hidden="true">{icon}</span><span>{label}</span></button>;
}

createRoot(document.querySelector<HTMLDivElement>('#root')!).render(<StrictMode><App /></StrictMode>);
