import type {
  CadCommandRequest,
  CadCommandResult,
  CadFEMProject,
  JobManifest,
  SolidStudy
} from '../../../../packages/cad-fem-schema';

const API_BASE = '';

async function api<T>(path: `/api/${string}`, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers
    },
    ...init
  });
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Request failed with status ${response.status}.`);
  return body;
}

export function createProject(project: CadFEMProject): Promise<{ project: CadFEMProject }> {
  return api('/api/cad/projects', { method: 'POST', body: JSON.stringify({ project }) });
}

export function applyCommand(projectId: string, request: CadCommandRequest): Promise<CadCommandResult> {
  return api(`/api/cad/projects/${projectId}/commands`, { method: 'POST', body: JSON.stringify(request) });
}

function jobRequest(project: CadFEMProject, study: SolidStudy, idempotencyKey: string) {
  return {
    idempotencyKey,
    projectId: project.id,
    projectRevision: project.revision,
    geometryRevision: study.geometryRevision,
    settings: {
      mesh: study.mesh,
      solver: study.solver
    }
  };
}

export function queueMesh(project: CadFEMProject, study: SolidStudy, idempotencyKey: string): Promise<{ job: JobManifest }> {
  return api(`/api/fea/studies/${study.id}/mesh-jobs`, {
    method: 'POST',
    body: JSON.stringify(jobRequest(project, study, idempotencyKey))
  });
}

export function queueSolve(project: CadFEMProject, study: SolidStudy, idempotencyKey: string): Promise<{ job: JobManifest }> {
  return api(`/api/fea/studies/${study.id}/solve-jobs`, {
    method: 'POST',
    body: JSON.stringify(jobRequest(project, study, idempotencyKey))
  });
}
