import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createCadFEMProject,
  type CadCommand,
  type CadFEMProject,
  type CadRevisionSummary,
  type CatalogueSectionSnapshot,
  type JobManifest,
  type PartFeature,
  type Sketch
} from '../../../packages/cad-fem-schema';
import { validateCadFEMProject } from '../../../packages/cad-fem-validation';
import {
  applyCommand,
  createProject,
  createStepImportUpload,
  getCatalogueSectionProfile,
  getProject,
  listCatalogueSections,
  listProjectRevisions,
  queueMesh,
  queueSolve,
  queueStepImport,
  solveSketch,
  uploadStepArtifact,
  type CatalogueSectionListItem
} from './api/client';
import { RevisionTimeline } from './components/RevisionTimeline';
import { SketchEditor } from './components/SketchEditor';
import { Viewport } from './components/Viewport';
import './styles.css';

function newProject(): CadFEMProject {
  const project = createCadFEMProject();
  project.metadata.name = 'Solid CAD/FEM project';
  return project;
}

function catalogueFeatures(project: CadFEMProject) {
  return project.partDocuments.flatMap(({ features }) => features.filter(
    (feature): feature is Extract<PartFeature, { type: 'catalogueExtrusion' }> => feature.type === 'catalogueExtrusion'
  ));
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function App() {
  const [project, setProject] = useState(newProject);
  const [persisted, setPersisted] = useState(false);
  const [revisions, setRevisions] = useState<CadRevisionSummary[]>([]);
  const [contentRevision, setContentRevision] = useState(0);
  const [undoStack, setUndoStack] = useState<number[]>([]);
  const [redoStack, setRedoStack] = useState<number[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueSectionListItem[]>([]);
  const [catalogueStatus, setCatalogueStatus] = useState('Loading the Beam EC3 section catalogue…');
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState('All');
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const [profile, setProfile] = useState<CatalogueSectionSnapshot | null>(null);
  const [memberLength, setMemberLength] = useState(3000);
  const [activeTree, setActiveTree] = useState<'model' | 'study' | 'results'>('model');
  const [selected, setSelected] = useState('Part 1');
  const [selectedFeatureId, setSelectedFeatureId] = useState('');
  const [wireframe, setWireframe] = useState(false);
  const [status, setStatus] = useState('New local project — create a sketch, import STEP, or insert an EC3 section');
  const [job, setJob] = useState<JobManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingSketch, setEditingSketch] = useState<Sketch | 'new' | null>(null);
  const [extrudeDistance, setExtrudeDistance] = useState(100);
  const [revolveAngle, setRevolveAngle] = useState(360);
  const [stepFile, setStepFile] = useState<File | null>(null);

  const report = useMemo(() => validateCadFEMProject(project), [project]);
  const study = project.studies[0];
  const document = project.partDocuments[0];
  const savedCatalogueFeatures = useMemo(() => catalogueFeatures(project), [project]);
  const selectedFeature = document.features.find(({ id }) => id === selectedFeatureId);
  const selectedSketch = selectedFeature?.type === 'sketch'
    ? document.sketches.find(({ id }) => id === selectedFeature.sketchId)
    : document.sketches[0];
  const previewSketch = selectedFeature
    ? (['sketch', 'extrude', 'revolve'].includes(selectedFeature.type)
      ? document.sketches.find(({ id }) => 'sketchId' in selectedFeature && id === selectedFeature.sketchId) || null
      : null)
    : document.sketches[0] || null;
  const previewExtrusion = selectedFeature?.type === 'extrude' ? selectedFeature.distance : null;

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
      if (active) setCatalogueStatus(error instanceof Error ? error.message : String(error));
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

  const refreshHistory = async (projectId: string) => {
    const response = await listProjectRevisions(projectId);
    setRevisions(response.revisions);
  };

  const ensurePersisted = async (): Promise<CadFEMProject> => {
    if (persisted) return project;
    const response = await createProject(project);
    setProject(response.project);
    setPersisted(true);
    setContentRevision(0);
    await refreshHistory(response.project.id);
    return response.project;
  };

  const commitCommand = async (command: CadCommand, success: string): Promise<CadFEMProject> => {
    const working = await ensurePersisted();
    const previousContent = contentRevision;
    const result = await applyCommand(working.id, {
      commandId: crypto.randomUUID(),
      baseRevision: working.revision,
      command
    });
    const refreshed = await getProject(working.id);
    setProject(refreshed.project);
    setUndoStack((current) => [...current, previousContent]);
    setRedoStack([]);
    setContentRevision(result.revision);
    await refreshHistory(working.id);
    setStatus(`${success} Saved as revision ${result.revision}. ${result.warnings.join(' ')}`.trim());
    return refreshed.project;
  };

  const runCommand = async (command: CadCommand, success: string) => {
    setBusy(true);
    try {
      await commitCommand(command, success);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const restoreRevision = async (targetRevision: number, navigation: 'undo' | 'redo' | 'explicit') => {
    if (!persisted || targetRevision >= project.revision) return;
    setBusy(true);
    try {
      const result = await applyCommand(project.id, {
        commandId: crypto.randomUUID(),
        baseRevision: project.revision,
        command: { type: 'restoreRevision', targetRevision }
      });
      const refreshed = await getProject(project.id);
      setProject(refreshed.project);
      if (navigation === 'undo') {
        setUndoStack((current) => current.slice(0, -1));
        setRedoStack((current) => [...current, contentRevision]);
      } else if (navigation === 'redo') {
        setRedoStack((current) => current.slice(0, -1));
        setUndoStack((current) => [...current, contentRevision]);
      } else {
        setUndoStack((current) => [...current, contentRevision]);
        setRedoStack([]);
      }
      setContentRevision(targetRevision);
      setSelectedFeatureId('');
      await refreshHistory(project.id);
      setStatus(`Restored model content from revision ${targetRevision}; immutable restore command saved as revision ${result.revision}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const resetProject = () => {
    setProject(newProject());
    setPersisted(false);
    setRevisions([]);
    setContentRevision(0);
    setUndoStack([]);
    setRedoStack([]);
    setJob(null);
    setSelectedFeatureId('');
    setEditingSketch(null);
    setStatus('New local project — create a sketch, import STEP, or insert an EC3 section');
  };

  const addSelectedSection = async () => {
    if (!profile || !Number.isFinite(memberLength) || memberLength <= 0) {
      setStatus('Select a section and enter a positive member length.');
      return;
    }
    if (savedCatalogueFeatures.some((feature) => feature.section.sectionId === profile.sectionId && feature.length === memberLength)) {
      setStatus(`${profile.designation} × ${memberLength} mm is already in this project.`);
      return;
    }
    if (savedCatalogueFeatures.length) {
      setStatus('The current native catalogue meshing gate accepts one EC3 section per project. Start a new project for another section.');
      return;
    }
    await runCommand({
      type: 'appendCatalogueExtrusion',
      documentId: document.id,
      featureId: crypto.randomUUID(),
      bodyId: crypto.randomUUID(),
      componentId: crypto.randomUUID(),
      sectionId: profile.sectionId,
      length: memberLength,
      name: `${profile.designation} × ${memberLength} mm`
    }, `${profile.designation} section model added.`);
  };

  const saveSketch = async (sketch: Sketch) => {
    setBusy(true);
    try {
      const refreshed = await commitCommand({
        type: 'upsertSketch',
        documentId: project.partDocuments[0].id,
        sketch,
        featureId: crypto.randomUUID()
      }, `${sketch.name} saved.`);
      const feature = refreshed.partDocuments[0].features.find((candidate) => candidate.type === 'sketch' && candidate.sketchId === sketch.id);
      if (feature) {
        setSelectedFeatureId(feature.id);
        setSelected(feature.name);
      }
      setEditingSketch(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const runSketchSolve = async (sketch: Sketch): Promise<Sketch> => {
    const working = await ensurePersisted();
    const result = await solveSketch(working.id, working.revision, working.partDocuments[0].id, sketch);
    setStatus(`Native Ceres returned ${result.sketch.solverState}. Save the sketch to create a project revision.`);
    return result.sketch;
  };

  const createExtrude = async () => {
    if (!selectedSketch || !(extrudeDistance > 0)) {
      setStatus('Create or select a sketch and enter a positive extrusion distance.');
      return;
    }
    await runCommand({
      type: 'appendFeature',
      documentId: document.id,
      feature: {
        id: crypto.randomUUID(), name: `${selectedSketch.name} extrusion`, type: 'extrude',
        sketchId: selectedSketch.id, distance: extrudeDistance, direction: 'normal',
        operation: 'newBody', targetBodyIds: [], suppressed: false,
        regenerationState: 'pending', diagnostics: []
      }
    }, 'Extrusion feature added; native OCCT regeneration is still required.');
  };

  const createRevolve = async () => {
    const axis = selectedSketch?.entities.find((entity) => entity.type === 'line');
    if (!selectedSketch || !axis || !(revolveAngle > 0 && revolveAngle <= 360)) {
      setStatus('A sketch containing a line axis and an angle from 0 to 360° is required.');
      return;
    }
    await runCommand({
      type: 'appendFeature',
      documentId: document.id,
      feature: {
        id: crypto.randomUUID(), name: `${selectedSketch.name} revolve`, type: 'revolve',
        sketchId: selectedSketch.id, axisEntityId: axis.id, angleRad: revolveAngle * Math.PI / 180,
        operation: 'newBody', targetBodyIds: [], suppressed: false,
        regenerationState: 'pending', diagnostics: []
      }
    }, 'Revolve feature added; native OCCT regeneration is still required.');
  };

  const importStep = async () => {
    if (!stepFile) {
      setStatus('Choose a STEP or STP file first.');
      return;
    }
    setBusy(true);
    try {
      const working = await ensurePersisted();
      setStatus('Hashing the STEP file locally…');
      const sha256 = await sha256File(stepFile);
      const grant = await createStepImportUpload(working.id, {
        fileName: stepFile.name,
        contentType: stepFile.type || 'application/step',
        byteLength: stepFile.size,
        sha256
      });
      setStatus('Uploading the immutable STEP artefact…');
      await uploadStepArtifact(grant, stepFile);
      const response = await queueStepImport(working.id, {
        stepArtifactId: grant.artifact.id,
        baseRevision: working.revision,
        idempotencyKey: crypto.randomUUID()
      });
      setJob(response.job);
      setStatus(`STEP import job ${response.job.stage}. OCCT geometry will be authoritative only after completion.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const saveEngineeringSettings = async () => {
    setBusy(true);
    try {
      const working = await ensurePersisted();
      const previousContent = contentRevision;
      const materialResult = await applyCommand(working.id, {
        commandId: crypto.randomUUID(),
        baseRevision: working.revision,
        command: { type: 'upsertMaterial', material: project.materials[0] }
      });
      const afterMaterial = (await getProject(working.id)).project;
      const studyResult = await applyCommand(working.id, {
        commandId: crypto.randomUUID(),
        baseRevision: afterMaterial.revision,
        command: { type: 'upsertStudy', study: project.studies[0] }
      });
      const refreshed = (await getProject(working.id)).project;
      setProject(refreshed);
      setUndoStack((current) => [...current, previousContent]);
      setRedoStack([]);
      setContentRevision(studyResult.revision);
      await refreshHistory(working.id);
      setStatus(`Material and study settings saved as revisions ${materialResult.revision}–${studyResult.revision}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (kind: 'mesh' | 'solve') => {
    if (kind === 'mesh' && (!persisted || savedCatalogueFeatures.length !== 1)) {
      setStatus('The released mesh path currently requires one saved EC3 catalogue section or a completed STEP import.');
      return;
    }
    if (kind === 'solve' && !report.valid) {
      setStatus('Define valid supports and loads before native analysis. No browser solver substitute is used.');
      return;
    }
    setBusy(true);
    try {
      const response = kind === 'mesh'
        ? await queueMesh(project, study, crypto.randomUUID())
        : await queueSolve(project, study, crypto.randomUUID());
      setJob(response.job);
      setStatus(`${response.job.kind} job ${response.job.stage}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const updateMaterial = (key: 'elasticModulus' | 'poissonRatio', value: number) => {
    setProject((current) => {
      const next = structuredClone(current);
      next.materials[0][key] = value;
      return next;
    });
  };

  const selectFeature = (feature: PartFeature) => {
    setSelectedFeatureId(feature.id);
    setSelected(feature.name);
  };

  const meshReady = persisted && savedCatalogueFeatures.length === 1 && !busy;
  const analysisReady = report.valid && persisted && !busy;

  return <div className="workbench">
    <header className="appbar">
      <a className="brand" href="/frame3d/"><span className="mark">BC</span><span>Solid CAD/FEM</span></a>
      <div className="document-title"><strong>{project.metadata.name}</strong><span>Beta · revision {project.revision}</span></div>
      <div className="app-actions">
        <button type="button" disabled={busy || !undoStack.length} onClick={() => void restoreRevision(undoStack.at(-1)!, 'undo')}>Undo</button>
        <button type="button" disabled={busy || !redoStack.length} onClick={() => void restoreRevision(redoStack.at(-1)!, 'redo')}>Redo</button>
        <button type="button" disabled={busy} onClick={resetProject}>New project</button>
        <a href="/frame3d/frame/">Frame analysis</a>
      </div>
    </header>

    <div className="commandbar">
      <div className="command-group active-command"><span>EC3 catalogue</span><button type="button" onClick={() => setSelected('Section catalogue')}>Insert section</button></div>
      <div className="command-group"><span>Sketch</span><button type="button" disabled={busy} onClick={() => setEditingSketch('new')}>Create sketch</button><button type="button" disabled={busy || !selectedSketch} onClick={() => selectedSketch && setEditingSketch(selectedSketch)}>Edit sketch</button></div>
      <div className="command-group"><span>Features</span><button type="button" disabled={busy || !selectedSketch} onClick={() => void createExtrude()}>Extrude</button><button type="button" disabled={busy || !selectedSketch} onClick={() => void createRevolve()}>Revolve</button><button type="button" disabled title="Requires an authoritative OCCT face selection">Hole</button><button type="button" disabled title="Requires authoritative OCCT edge topology">Fillet</button></div>
      <div className="command-group"><span>Exchange</span><label className="file-button">Choose STEP<input type="file" accept=".step,.stp,application/step" onChange={(event) => setStepFile(event.target.files?.[0] || null)} /></label><button type="button" disabled={busy || !stepFile} onClick={() => void importStep()}>Import</button></div>
      <div className="command-group"><span>Analysis</span><button type="button" disabled={!meshReady} onClick={() => void submit('mesh')}>Generate mesh</button><button className="primary" type="button" disabled={!analysisReady} onClick={() => void submit('solve')}>Run study</button></div>
    </div>

    <aside className="tree-panel">
      <div className="tree-tabs">
        {(['model', 'study', 'results'] as const).map((tab) => <button className={activeTree === tab ? 'active' : ''} type="button" onClick={() => setActiveTree(tab)} key={tab}>{tab}</button>)}
      </div>
      {activeTree === 'model' && <div className="tree">
        <TreeRow label={document.name} icon="P" selected={selected === document.name} onSelect={setSelected} />
        <div className="tree-indent">
          {document.features.map((feature) => <button type="button" className={`tree-row ${selectedFeatureId === feature.id ? 'selected' : ''}`} key={feature.id} onClick={() => selectFeature(feature)}><span aria-hidden="true">F</span><span>{feature.name}</span></button>)}
          {document.bodies.map((body) => <TreeRow key={body.id} label={body.name} icon="B" selected={selected === body.name} onSelect={setSelected} />)}
          {!document.features.length && <p className="tree-hint">Create a sketch, import STEP, or insert a Beam EC3 section.</p>}
        </div>
        <TreeRow label={project.assembly.name} icon="A" selected={selected === project.assembly.name} onSelect={setSelected} />
        <div className="tree-indent">{project.assembly.components.map((component) => <TreeRow key={component.id} label={component.name} icon="C" selected={selected === component.name} onSelect={setSelected} />)}</div>
      </div>}
      {activeTree === 'study' && <div className="tree">
        <TreeRow label={study.name} icon="Σ" selected={selected === study.name} onSelect={setSelected} />
        <div className="tree-indent">
          {['Materials', 'Contacts', 'Supports', 'Loads', 'Mesh'].map((item) => <TreeRow key={item} label={item} icon={item[0]} selected={selected === item} onSelect={setSelected} />)}
        </div>
      </div>}
      {activeTree === 'results' && <div className="empty-tree">{job?.stage === 'complete' ? 'Native result artefacts are available.' : 'No completed native solution.'}</div>}
      <div className="tree-footer"><span className={report.valid ? 'valid' : 'invalid'}>{report.valid ? 'Study ready' : `${report.errors.length} analysis requirements outstanding`}</span></div>
    </aside>

    <main className="viewport-panel">
      <div className="viewport-tools">
        <button className={!wireframe ? 'active' : ''} type="button" onClick={() => setWireframe(false)}>Shaded</button>
        <button className={wireframe ? 'active' : ''} type="button" onClick={() => setWireframe(true)}>Wireframe</button>
        <button type="button" disabled title="Available only after a native mesh job completes">Mesh unavailable</button>
        <span>Non-authoritative browser preview · mm</span>
      </div>
      <Viewport profile={profile} length={memberLength} wireframe={wireframe} sketch={previewSketch} extrusion={previewExtrusion} />
      <div className="view-notice">Browser tessellation is a drafting preview. OCCT B-rep regeneration, topology, radii, meshing and solver results are authoritative only when returned by the native service.</div>
      <RevisionTimeline features={document.features} revisions={revisions} currentRevision={project.revision} busy={busy} onSelectFeature={selectFeature} onRestore={(revision) => restoreRevision(revision, 'explicit')} />
    </main>

    <aside className="properties-panel">
      <div className="panel-heading"><span>Properties</span><strong>{selected}</strong></div>
      {selectedFeature && <section className="feature-properties">
        <h3>Selected feature</h3>
        <dl><div><dt>Type</dt><dd>{selectedFeature.type}</dd></div><div><dt>Regeneration</dt><dd>{selectedFeature.regenerationState || 'Legacy'}</dd></div></dl>
        {selectedFeature.type === 'sketch' && <button className="wide-action" type="button" onClick={() => { const sketch = document.sketches.find(({ id }) => id === selectedFeature.sketchId); if (sketch) setEditingSketch(sketch); }}>Edit sketch</button>}
        <button type="button" disabled={busy} onClick={() => void runCommand({ type: 'suppressFeature', documentId: document.id, featureId: selectedFeature.id, suppressed: !selectedFeature.suppressed }, selectedFeature.suppressed ? 'Feature restored.' : 'Feature suppressed.')}>{selectedFeature.suppressed ? 'Unsuppress' : 'Suppress'}</button>
      </section>}
      <section className="feature-properties">
        <h3>Parametric feature</h3>
        <label>Extrusion distance [mm]<input type="number" min="0.1" value={extrudeDistance} onChange={(event) => setExtrudeDistance(Number(event.target.value))} /></label>
        <button className="wide-action" type="button" disabled={busy || !selectedSketch} onClick={() => void createExtrude()}>Create extrusion</button>
        <label>Revolve angle [degrees]<input type="number" min="0.1" max="360" value={revolveAngle} onChange={(event) => setRevolveAngle(Number(event.target.value))} /></label>
        <button className="wide-action" type="button" disabled={busy || !selectedSketch} onClick={() => void createRevolve()}>Create revolve</button>
      </section>
      <section className="catalogue-properties">
        <h3>Beam EC3 section data</h3>
        <label>Search<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. UB 254 or RHS" /></label>
        <label>Family<select value={family} onChange={(event) => setFamily(event.target.value)}>{families.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label>Section<select value={selectedSectionId} onChange={(event) => setSelectedSectionId(event.target.value)}>{filteredCatalogue.map((section) => <option value={section.id} key={section.id}>{section.designation} · {section.mass_kg_m} kg/m</option>)}</select></label>
        <label>Member length [mm]<input type="number" min="1" step="10" value={memberLength} onChange={(event) => setMemberLength(Number(event.target.value))} /></label>
        <button className="wide-action" type="button" disabled={busy || !profile} onClick={() => void addSelectedSection()}>Add section to project</button>
        <p className="catalogue-status">{catalogueStatus}</p>
        {profile && <dl className="section-dimensions">
          <div><dt>Depth</dt><dd>{profile.dimensions.height} mm</dd></div><div><dt>Width</dt><dd>{profile.dimensions.width} mm</dd></div>
          <div><dt>Area</dt><dd>{profile.properties.area.toLocaleString('en-GB')} mm²</dd></div><div><dt>Mass</dt><dd>{profile.properties.massPerLength ?? '—'} kg/m</dd></div>
          <div><dt>{profile.kind === 'rhs' ? 'Wall' : 'Web'}</dt><dd>{profile.kind === 'rhs' ? profile.dimensions.wallThickness : profile.dimensions.webThickness} mm</dd></div>
          <div><dt>{profile.kind === 'rhs' ? 'Outer radius' : 'Flange'}</dt><dd>{profile.kind === 'rhs' ? profile.dimensions.rootRadius : profile.dimensions.flangeThickness} mm</dd></div>
        </dl>}
        {profile && <p className="catalogue-source">Source: <a href={profile.source.url} target="_blank" rel="noreferrer">{profile.source.title}</a></p>}
      </section>
      <section>
        <h3>Material and mesh</h3>
        <label>Elastic modulus [N/mm²]<input type="number" value={project.materials[0].elasticModulus} onChange={(event) => updateMaterial('elasticModulus', Number(event.target.value))} /></label>
        <label>Poisson ratio<input type="number" step="0.01" value={project.materials[0].poissonRatio} onChange={(event) => updateMaterial('poissonRatio', Number(event.target.value))} /></label>
        <label>Element order<select value={study.mesh.elementOrder} onChange={(event) => setProject((current) => { const next = structuredClone(current); next.studies[0].mesh.elementOrder = Number(event.target.value) as 1 | 2; return next; })}><option value="2">Quadratic tetrahedra</option><option value="1">Linear diagnostic only</option></select></label>
        <label>Global size [mm]<input type="number" value={study.mesh.globalSize} onChange={(event) => setProject((current) => { const next = structuredClone(current); next.studies[0].mesh.globalSize = Number(event.target.value); return next; })} /></label>
        <button className="wide-action" type="button" disabled={busy} onClick={() => void saveEngineeringSettings()}>Save engineering settings</button>
      </section>
      <section className="diagnostics">
        <h3>Analysis readiness</h3>
        {[...report.errors, ...report.warnings].slice(0, 8).map((item) => <p className={item.severity} key={`${item.code}-${item.message}`}>{item.message}</p>)}
        {report.errors.length === 0 && report.warnings.length === 0 && <p className="info">No model diagnostics.</p>}
      </section>
    </aside>

    <footer className="statusbar">
      <span>{status}</span>
      <span>{job ? `Job ${job.id.slice(0, 8)} · ${job.stage} · ${Math.round(job.progress * 100)}%` : `${document.sketches.length} sketches · ${document.features.length} features`}</span>
      <strong>Beta · independently verify engineering results.</strong>
    </footer>

    {editingSketch && <SketchEditor
      key={editingSketch === 'new' ? 'new' : editingSketch.id}
      initial={editingSketch === 'new' ? undefined : editingSketch}
      busy={busy}
      onClose={() => setEditingSketch(null)}
      onSave={saveSketch}
      onSolve={runSketchSolve}
    />}
  </div>;
}

function TreeRow({ label, icon, selected, onSelect }: { label: string; icon: string; selected: boolean; onSelect: (value: string) => void }) {
  return <button type="button" className={`tree-row ${selected ? 'selected' : ''}`} onClick={() => onSelect(label)}><span aria-hidden="true">{icon}</span><span>{label}</span></button>;
}

createRoot(document.querySelector<HTMLDivElement>('#root')!).render(<StrictMode><App /></StrictMode>);
