const fs = require('fs/promises');
const path = require('path');
const { createHash, randomUUID } = require('crypto');
const { config } = require('../config');
const postgresRepository = require('./cad-fem-postgres-repository');
const awsJobs = require('./cad-fem-aws-jobs');
const { getSectionById, buildSectionProfileSnapshot } = require('./sections-service');

const CAD_FEM_SCHEMA_VERSION = '1.0.0';
const CAD_FEM_API_VERSION = '1.0.0';

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function assertUuid(value, field) {
  if (!/^[a-f0-9-]{36}$/i.test(String(value || ''))) {
    throw httpError(400, 'invalid_identifier', `${field} must be a UUID.`);
  }
}

function assertCadFemProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw httpError(400, 'project_invalid', 'A CAD/FEM project object is required.');
  }
  if (project.schemaVersion !== CAD_FEM_SCHEMA_VERSION) {
    throw httpError(422, 'schema_version_unsupported', `Unsupported CAD/FEM schema version ${String(project.schemaVersion)}.`);
  }
  assertUuid(project.id, 'Project ID');
  if (!Number.isInteger(project.revision) || project.revision < 0) {
    throw httpError(422, 'project_revision_invalid', 'Project revision must be a non-negative integer.');
  }
  if (!project.metadata || typeof project.metadata.name !== 'string' || !project.metadata.name.trim()) {
    throw httpError(422, 'project_name_required', 'Project name is required.');
  }
  if (!Array.isArray(project.partDocuments) || !Array.isArray(project.materials) || !Array.isArray(project.studies)) {
    throw httpError(422, 'project_collections_invalid', 'Part documents, materials and studies must be arrays.');
  }
}

function ownerDirectory(ownerId) {
  return path.join(config.storageDir, 'cad-fem', String(ownerId));
}

function projectFile(ownerId, projectId) {
  return path.join(ownerDirectory(ownerId), `${projectId}.json`);
}

function ensureLocalStorageAllowed() {
  if (config.env === 'production') {
    throw httpError(503, 'cad_fem_repository_unconfigured', 'CAD/FEM production persistence requires the PostgreSQL native service.');
  }
}

function usesPostgres() {
  return Boolean(config.cadFemDatabaseUrl || config.cadFemDatabaseHost);
}

async function readStoredProject(ownerId, projectId) {
  assertUuid(projectId, 'Project ID');
  ensureLocalStorageAllowed();
  try {
    const stored = JSON.parse(await fs.readFile(projectFile(ownerId, projectId), 'utf8'));
    if (stored.ownerId !== ownerId) throw new Error('owner mismatch');
    return stored;
  } catch (error) {
    if (error?.statusCode) throw error;
    throw httpError(404, 'cad_fem_project_not_found', 'CAD/FEM project not found.');
  }
}

async function writeStoredProject(ownerId, stored) {
  ensureLocalStorageAllowed();
  await fs.mkdir(ownerDirectory(ownerId), { recursive: true });
  await fs.writeFile(projectFile(ownerId, stored.project.id), JSON.stringify(stored, null, 2), 'utf8');
}

async function listCadFemProjects(ownerId) {
  if (usesPostgres()) return postgresRepository.listProjects(ownerId);
  ensureLocalStorageAllowed();
  const directory = ownerDirectory(ownerId);
  await fs.mkdir(directory, { recursive: true });
  const names = await fs.readdir(directory);
  const projects = [];
  for (const name of names.filter((value) => value.endsWith('.json'))) {
    const stored = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
    if (stored.ownerId !== ownerId) continue;
    projects.push({
      id: stored.project.id,
      name: stored.project.metadata.name,
      revision: stored.project.revision,
      updatedAt: stored.project.metadata.updatedAt,
      geometryRevision: Math.max(0, ...stored.project.partDocuments.map(({ geometryRevision = 0 }) => geometryRevision))
    });
  }
  return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function createCadFemProject(ownerId, input) {
  const project = structuredClone(input);
  assertCadFemProject(project);
  project.revision = 0;
  project.metadata.createdAt ||= new Date().toISOString();
  project.metadata.updatedAt = project.metadata.createdAt;
  if (usesPostgres()) return postgresRepository.createProject(ownerId, project);
  ensureLocalStorageAllowed();
  const stored = {
    ownerId,
    project,
    commandResults: {},
    revisionLog: [{
      revision: 0,
      commandId: null,
      createdAt: project.metadata.createdAt,
      project: structuredClone(project)
    }]
  };
  try {
    await fs.access(projectFile(ownerId, project.id));
    throw httpError(409, 'cad_fem_project_exists', 'A CAD/FEM project with this ID already exists.');
  } catch (error) {
    if (error?.statusCode) throw error;
  }
  await writeStoredProject(ownerId, stored);
  return project;
}

async function readCadFemProject(ownerId, projectId) {
  if (usesPostgres()) return postgresRepository.readProject(ownerId, projectId);
  return (await readStoredProject(ownerId, projectId)).project;
}

function revisionSummary(entry) {
  const geometryRevision = Math.max(0, ...entry.project.partDocuments.map(({ geometryRevision = 0 }) => geometryRevision));
  return {
    revision: entry.revision,
    geometryRevision,
    commandId: entry.commandId || null,
    commandType: entry.commandType || entry.command?.type || null,
    ...(entry.command?.type === 'restoreRevision' ? { targetRevision: entry.command.targetRevision } : {}),
    createdAt: entry.createdAt
  };
}

async function listCadFemProjectRevisions(ownerId, projectId) {
  assertUuid(projectId, 'Project ID');
  if (usesPostgres()) return postgresRepository.listProjectRevisions(ownerId, projectId);
  const stored = await readStoredProject(ownerId, projectId);
  return stored.revisionLog.map(revisionSummary);
}

async function readCadFemProjectRevision(ownerId, projectId, revisionNumber) {
  assertUuid(projectId, 'Project ID');
  if (!Number.isInteger(revisionNumber) || revisionNumber < 0) {
    throw httpError(400, 'revision_invalid', 'Revision must be a non-negative integer.');
  }
  if (usesPostgres()) return postgresRepository.readProjectRevision(ownerId, projectId, revisionNumber);
  const stored = await readStoredProject(ownerId, projectId);
  const entry = stored.revisionLog.find(({ revision }) => revision === revisionNumber);
  if (!entry) throw httpError(404, 'cad_fem_revision_not_found', `CAD/FEM project revision ${revisionNumber} was not found.`);
  return structuredClone(entry.project);
}

function upsertById(values, value) {
  const index = values.findIndex(({ id }) => id === value.id);
  if (index >= 0) values[index] = structuredClone(value);
  else values.push(structuredClone(value));
}

function findDocument(project, documentId) {
  const document = project.partDocuments.find(({ id }) => id === documentId);
  if (!document) throw httpError(422, 'part_document_not_found', 'Command references a missing part document.');
  return document;
}

function markDocumentDirty(document) {
  document.geometryRevision += 1;
  document.regeneration = {
    state: 'notGenerated',
    nativeGeometryRevision: null,
    topologyRevision: document.regeneration?.topologyRevision || 0,
    diagnostics: []
  };
  for (const feature of document.features) {
    if (!feature.suppressed) feature.regenerationState = 'pending';
    feature.diagnostics = [];
  }
}

function featureUsesSketch(feature, sketchId) {
  return ['sketch', 'extrude', 'revolve'].includes(feature.type) && feature.sketchId === sketchId;
}

function featureUsesFeature(feature, featureId) {
  if (['linearPattern', 'circularPattern'].includes(feature.type)) {
    return feature.sourceFeatureIds.includes(featureId);
  }
  if (['fillet', 'chamfer'].includes(feature.type)) {
    return feature.edges.some((edge) => edge.featureId === featureId);
  }
  return feature.type === 'hole' && feature.placement.featureId === featureId;
}

function restoreProjectSnapshot(project, snapshot) {
  if (!snapshot || snapshot.id !== project.id || snapshot.schemaVersion !== project.schemaVersion) {
    throw httpError(422, 'restore_revision_invalid', 'The requested revision cannot be restored into this project.');
  }
  const currentRevision = project.revision;
  const currentGeometryRevision = Math.max(0, ...project.partDocuments.map(({ geometryRevision = 0 }) => geometryRevision));
  const currentAssemblyRevision = project.assembly.revision;
  const createdAt = project.metadata.createdAt;
  const restored = structuredClone(snapshot);
  restored.revision = currentRevision;
  restored.metadata.createdAt = createdAt;
  for (const document of restored.partDocuments) {
    document.geometryRevision = currentGeometryRevision + 1;
    document.regeneration = {
      state: 'notGenerated',
      nativeGeometryRevision: null,
      topologyRevision: document.regeneration?.topologyRevision || 0,
      diagnostics: [{
        code: 'revision_restored_regeneration_required',
        message: 'This restored revision must be regenerated by the native OCCT service.',
        entityIds: [document.id]
      }]
    };
    for (const feature of document.features) {
      feature.regenerationState = feature.suppressed ? feature.regenerationState : 'pending';
      feature.diagnostics = [];
    }
  }
  restored.assembly.revision = currentAssemblyRevision + 1;
  for (const key of Object.keys(project)) delete project[key];
  Object.assign(project, restored);
}

function applyCommandToProject(project, command, context = {}) {
  const warnings = [];
  switch (command?.type) {
    case 'renameProject':
      project.metadata.name = String(command.name || '').trim().slice(0, 180);
      if (!project.metadata.name) throw httpError(422, 'project_name_required', 'Project name is required.');
      break;
    case 'appendCatalogueExtrusion': {
      const document = findDocument(project, command.documentId);
      assertUuid(command.featureId, 'Feature ID');
      assertUuid(command.bodyId, 'Body ID');
      assertUuid(command.componentId, 'Component ID');
      const length = Number(command.length);
      if (!Number.isFinite(length) || length <= 0 || length > 1_000_000) {
        throw httpError(422, 'catalogue_extrusion_length_invalid', 'Catalogue extrusion length must be greater than 0 and no more than 1,000,000 mm.');
      }
      if (document.features.some(({ id }) => id === command.featureId) ||
          document.bodies.some(({ id }) => id === command.bodyId) ||
          project.assembly.components.some(({ id }) => id === command.componentId)) {
        throw httpError(409, 'catalogue_entity_exists', 'A catalogue extrusion entity ID already exists.');
      }
      const section = getSectionById(command.sectionId);
      const snapshot = buildSectionProfileSnapshot(section);
      if (!section || !snapshot) {
        throw httpError(422, 'catalogue_profile_unavailable', 'The selected Beam EC3 section does not have complete solid-profile geometry.');
      }
      if (!snapshot.geometryVerified) {
        throw httpError(422, 'catalogue_profile_unverified', 'The selected section geometry is not marked as verified source data.');
      }
      const name = String(command.name || snapshot.designation).trim().slice(0, 180) || snapshot.designation;
      document.features.push({
        id: command.featureId,
        name: `${name} extrusion`,
        type: 'catalogueExtrusion',
        section: structuredClone(snapshot),
        length,
        operation: 'newBody',
        suppressed: false,
        regenerationState: 'pending',
        diagnostics: []
      });
      const materialId = project.materials[0]?.id || null;
      document.bodies.push({
        id: command.bodyId,
        name,
        sourceFeatureId: command.featureId,
        materialId,
        visible: true,
        topologyRevision: 1
      });
      project.assembly.components.push({
        id: command.componentId,
        name,
        partDocumentId: document.id,
        transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        grounded: false,
        visible: true
      });
      markDocumentDirty(document);
      project.assembly.revision += 1;
      const geometryRevision = Math.max(0, ...project.partDocuments.map(({ geometryRevision = 0 }) => geometryRevision));
      for (const study of project.studies) {
        study.geometryRevision = geometryRevision;
        if (materialId && !study.materialAssignments.some(({ componentId, bodyId }) => componentId === command.componentId && bodyId === command.bodyId)) {
          study.materialAssignments.push({ componentId: command.componentId, bodyId: command.bodyId, materialId });
        }
      }
      warnings.push(...snapshot.warnings);
      break;
    }
    case 'upsertSketch': {
      const document = findDocument(project, command.documentId);
      assertUuid(command.sketch?.id, 'Sketch ID');
      upsertById(document.sketches, command.sketch);
      if (!document.features.some((feature) => feature.type === 'sketch' && feature.sketchId === command.sketch.id)) {
        if (command.featureId) assertUuid(command.featureId, 'Sketch feature ID');
        document.features.push({
          id: command.featureId || randomUUID(),
          name: command.sketch.name,
          type: 'sketch',
          sketchId: command.sketch.id,
          suppressed: false,
          regenerationState: 'pending',
          diagnostics: []
        });
      }
      markDocumentDirty(document);
      break;
    }
    case 'deleteSketch': {
      const document = findDocument(project, command.documentId);
      const index = document.sketches.findIndex(({ id }) => id === command.sketchId);
      if (index < 0) throw httpError(422, 'sketch_not_found', 'Sketch does not exist.');
      const dependent = document.features.find((feature) => feature.type !== 'sketch' && featureUsesSketch(feature, command.sketchId));
      if (dependent) {
        throw httpError(409, 'sketch_has_dependants', `${dependent.name} depends on this sketch. Delete or suppress the dependent feature first.`);
      }
      document.features = document.features.filter((feature) => !(feature.type === 'sketch' && feature.sketchId === command.sketchId));
      document.sketches.splice(index, 1);
      markDocumentDirty(document);
      break;
    }
    case 'appendFeature': {
      const document = findDocument(project, command.documentId);
      if (document.features.some(({ id }) => id === command.feature.id)) {
        throw httpError(409, 'feature_exists', 'Feature ID already exists.');
      }
      document.features.push(structuredClone(command.feature));
      markDocumentDirty(document);
      break;
    }
    case 'updateFeature': {
      const document = findDocument(project, command.documentId);
      const index = document.features.findIndex(({ id }) => id === command.feature.id);
      if (index < 0) throw httpError(422, 'feature_not_found', 'Feature does not exist.');
      document.features[index] = structuredClone(command.feature);
      markDocumentDirty(document);
      break;
    }
    case 'deleteFeature': {
      const document = findDocument(project, command.documentId);
      const index = document.features.findIndex(({ id }) => id === command.featureId);
      if (index < 0) throw httpError(422, 'feature_not_found', 'Feature does not exist.');
      const body = document.bodies.find(({ sourceFeatureId }) => sourceFeatureId === command.featureId);
      const dependent = document.features.find((feature) => feature.id !== command.featureId && featureUsesFeature(feature, command.featureId));
      if (body || dependent) {
        throw httpError(409, 'feature_has_dependants', `${body?.name || dependent?.name} depends on this feature. Suppress it instead or remove its dependants first.`);
      }
      document.features.splice(index, 1);
      markDocumentDirty(document);
      break;
    }
    case 'suppressFeature': {
      const document = findDocument(project, command.documentId);
      const feature = document.features.find(({ id }) => id === command.featureId);
      if (!feature) throw httpError(422, 'feature_not_found', 'Feature does not exist.');
      feature.suppressed = Boolean(command.suppressed);
      markDocumentDirty(document);
      break;
    }
    case 'upsertComponent':
      upsertById(project.assembly.components, command.component);
      project.assembly.revision += 1;
      break;
    case 'upsertMate':
      upsertById(project.assembly.mates, command.mate);
      project.assembly.revision += 1;
      break;
    case 'upsertMaterial':
      upsertById(project.materials, command.material);
      break;
    case 'upsertStudy':
      upsertById(project.studies, command.study);
      break;
    case 'restoreRevision':
      restoreProjectSnapshot(project, context.restoreSnapshot);
      warnings.push(`Restored the model from revision ${command.targetRevision}. Native regeneration is required before meshing or solving.`);
      break;
    default:
      throw httpError(422, 'command_unsupported', `Unsupported CAD command ${String(command?.type)}.`);
  }
  return warnings;
}

async function applyCadFemCommand(ownerId, projectId, request) {
  assertUuid(request?.commandId, 'Command ID');
  if (!Number.isInteger(request?.baseRevision) || request.baseRevision < 0) {
    throw httpError(400, 'base_revision_invalid', 'Base revision must be a non-negative integer.');
  }
  let restoreSnapshot;
  if (request.command?.type === 'restoreRevision') {
    if (!Number.isInteger(request.command.targetRevision) || request.command.targetRevision < 0 || request.command.targetRevision >= request.baseRevision) {
      throw httpError(422, 'restore_revision_invalid', 'Restore target must be an existing revision earlier than the current base revision.');
    }
    restoreSnapshot = await readCadFemProjectRevision(ownerId, projectId, request.command.targetRevision);
  }
  const transform = (project) => {
    const nextRevision = project.revision + 1;
    const warnings = applyCommandToProject(project, request.command, { restoreSnapshot });
    project.revision = nextRevision;
    project.metadata.updatedAt = new Date().toISOString();
    const geometryRevision = Math.max(0, ...project.partDocuments.map(({ geometryRevision = 0 }) => geometryRevision));
    return {
      commandId: request.commandId,
      projectId,
      revision: project.revision,
      geometryRevision,
      warnings
    };
  };
  if (usesPostgres()) {
    return postgresRepository.applyCommand(ownerId, projectId, request, transform);
  }
  const stored = await readStoredProject(ownerId, projectId);
  const duplicate = stored.commandResults[request.commandId];
  if (duplicate) return duplicate;
  if (stored.project.revision !== request.baseRevision) {
    throw httpError(409, 'stale_project_revision', `Project is at revision ${stored.project.revision}; command was based on ${request.baseRevision}.`);
  }
  const result = transform(stored.project);
  stored.commandResults[request.commandId] = result;
  stored.revisionLog.push({
    revision: stored.project.revision,
    commandId: request.commandId,
    commandType: request.command?.type || null,
    command: structuredClone(request.command),
    createdAt: stored.project.metadata.updatedAt,
    project: structuredClone(stored.project)
  });
  await writeStoredProject(ownerId, stored);
  return result;
}

async function solveCadFemSketch(ownerId, projectId, body) {
  assertUuid(projectId, 'Project ID');
  assertUuid(body?.documentId, 'Part document ID');
  if (!Number.isInteger(body?.baseRevision) || body.baseRevision < 0) {
    throw httpError(400, 'base_revision_invalid', 'Base revision must be a non-negative integer.');
  }
  const project = await readCadFemProject(ownerId, projectId);
  if (project.revision !== body.baseRevision) {
    throw httpError(409, 'stale_project_revision', `Project is at revision ${project.revision}; sketch was based on ${body.baseRevision}.`);
  }
  findDocument(project, body.documentId);
  if (!body.sketch || typeof body.sketch !== 'object' || !Array.isArray(body.sketch.points) ||
      !Array.isArray(body.sketch.entities) || !Array.isArray(body.sketch.constraints)) {
    throw httpError(422, 'sketch_invalid', 'A sketch with points, entities and constraints is required.');
  }
  assertUuid(body.sketch.id, 'Sketch ID');
  const result = await nativeRequest(ownerId, `/v1/projects/${projectId}/sketches/solve`, {
    method: 'POST',
    body: JSON.stringify({
      apiVersion: CAD_FEM_API_VERSION,
      projectId,
      baseRevision: body.baseRevision,
      documentId: body.documentId,
      units: { length: 'mm', angle: 'rad' },
      sketch: body.sketch
    })
  });
  if (!result?.sketch?.solveEvidence || result.sketch.solveEvidence.kernel !== 'ceres') {
    throw httpError(502, 'native_sketch_evidence_missing', 'The native sketch service did not return Ceres solve evidence.');
  }
  return {
    apiVersion: CAD_FEM_API_VERSION,
    projectId,
    baseRevision: body.baseRevision,
    sketch: result.sketch
  };
}

async function nativeFetch(ownerId, pathname, init = {}) {
  if (!config.cadFemNativeBaseUrl) {
    throw httpError(503, 'native_compute_unavailable', 'Native CAD/FEM compute is not configured. No browser solver fallback is available.');
  }
  const response = await fetch(new URL(pathname, config.cadFemNativeBaseUrl), {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Beam-User-Id': ownerId,
      ...(config.cadFemNativeToken ? { Authorization: `Bearer ${config.cadFemNativeToken}` } : {}),
      ...init.headers
    }
  });
  return response;
}

async function nativeRequest(ownerId, pathname, init = {}) {
  const response = await nativeFetch(ownerId, pathname, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, body?.error?.code || 'native_compute_error', body?.error?.message || 'Native CAD/FEM service failed.');
  }
  return body;
}

async function queueCadFemJob(ownerId, studyId, kind, body) {
  assertUuid(studyId, 'Study ID');
  if (!['mesh', 'solve'].includes(kind)) throw httpError(400, 'job_kind_invalid', 'Unsupported CAD/FEM job kind.');
  const idempotencyKey = String(body?.idempotencyKey || '');
  if (!idempotencyKey || idempotencyKey.length > 180) {
    throw httpError(400, 'idempotency_key_required', 'A bounded idempotency key is required.');
  }
  if (awsJobs.available()) {
    return awsJobs.queueStudyJob(ownerId, studyId, kind, body);
  }
  return nativeRequest(ownerId, `/v1/studies/${studyId}/${kind}-jobs`, {
    method: 'POST',
    body: JSON.stringify({
      apiVersion: CAD_FEM_API_VERSION,
      idempotencyKey,
      inputHash: createHash('sha256').update(JSON.stringify(body || {})).digest('hex'),
      projectId: body?.projectId,
      projectRevision: body?.projectRevision,
      geometryRevision: body?.geometryRevision,
      artifactIds: Array.isArray(body?.artifactIds) ? body.artifactIds : [],
      settings: body?.settings && typeof body.settings === 'object' ? body.settings : {}
    })
  });
}

async function createCadFemImportUpload(ownerId, projectId, body) {
  assertUuid(projectId, 'Project ID');
  if (!awsJobs.available()) {
    throw httpError(503, 'artifact_upload_unavailable', 'The R2 artifact upload service is not configured.');
  }
  return awsJobs.createImportUpload(ownerId, projectId, body);
}

async function queueCadFemImport(ownerId, projectId, body) {
  assertUuid(projectId, 'Project ID');
  const idempotencyKey = String(body?.idempotencyKey || '');
  assertUuid(body?.stepArtifactId, 'STEP artifact ID');
  if (!idempotencyKey || idempotencyKey.length > 180) {
    throw httpError(400, 'idempotency_key_required', 'A bounded idempotency key is required.');
  }
  if (awsJobs.available()) {
    return awsJobs.queueImportJob(ownerId, projectId, body);
  }
  return nativeRequest(ownerId, `/v1/projects/${projectId}/import-jobs`, {
    method: 'POST',
    body: JSON.stringify({
      apiVersion: CAD_FEM_API_VERSION,
      idempotencyKey,
      stepArtifactId: body.stepArtifactId,
      baseRevision: body.baseRevision,
      inputHash: createHash('sha256').update(JSON.stringify(body || {})).digest('hex')
    })
  });
}

async function getCadFemJob(ownerId, jobId) {
  assertUuid(jobId, 'Job ID');
  if (awsJobs.available()) return awsJobs.getJob(ownerId, jobId);
  return nativeRequest(ownerId, `/v1/jobs/${jobId}`);
}

async function cancelCadFemJob(ownerId, jobId) {
  assertUuid(jobId, 'Job ID');
  if (awsJobs.available()) return awsJobs.cancelJob(ownerId, jobId);
  return nativeRequest(ownerId, `/v1/jobs/${jobId}`, { method: 'DELETE' });
}

async function getCadFemJobEvents(ownerId, jobId, lastEventId = '') {
  assertUuid(jobId, 'Job ID');
  if (awsJobs.available()) return awsJobs.eventsResponse(ownerId, jobId);
  return nativeFetch(ownerId, `/v1/jobs/${jobId}/events`, {
    method: 'GET',
    headers: lastEventId ? { 'Last-Event-ID': String(lastEventId) } : {}
  });
}

async function getCadFemArtifact(ownerId, jobId, artifactId) {
  assertUuid(jobId, 'Job ID');
  assertUuid(artifactId, 'Artifact ID');
  if (awsJobs.available()) return awsJobs.artifactResponse(ownerId, jobId, artifactId);
  return nativeFetch(ownerId, `/v1/jobs/${jobId}/artifacts/${artifactId}`, { method: 'GET' });
}

module.exports = {
  CAD_FEM_API_VERSION,
  CAD_FEM_SCHEMA_VERSION,
  assertCadFemProject,
  listCadFemProjects,
  createCadFemProject,
  readCadFemProject,
  listCadFemProjectRevisions,
  readCadFemProjectRevision,
  applyCadFemCommand,
  solveCadFemSketch,
  createCadFemImportUpload,
  queueCadFemImport,
  queueCadFemJob,
  getCadFemJob,
  cancelCadFemJob,
  getCadFemJobEvents,
  getCadFemArtifact
};
