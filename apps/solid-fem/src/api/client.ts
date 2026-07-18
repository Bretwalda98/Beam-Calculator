import type {
  CadCommandRequest,
  CadCommandResult,
  CadRevisionSummary,
  CatalogueSectionSnapshot,
  CadFEMProject,
  JobManifest,
  Sketch,
  SketchSolveResult,
  SolidStudy
} from '../../../../packages/cad-fem-schema';

function apiBase(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return '';
  const pagesSuffix = '.beam-calculator.pages.dev';
  if (location.hostname.endsWith(pagesSuffix) && location.hostname !== 'beam-calculator.pages.dev') {
    const branch = location.hostname.slice(0, -pagesSuffix.length);
    return `https://${branch}-beam-calculator-api.harrynixon98.workers.dev`;
  }
  return 'https://beam-calculator-api.harrynixon98.workers.dev';
}

const API_BASE = apiBase();

export interface CatalogueSectionListItem {
  id: string;
  family: string;
  designation: string;
  mass_kg_m: number;
  sourceName: string;
  sourceEdition: string;
  solidProfileAvailable: boolean;
  catalogueRevision: string;
}

export interface StepUploadGrant {
  artifact: { id: string; sha256: string; byteLength: number; contentType: string };
  upload: { method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: string };
}

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

export function getProject(projectId: string): Promise<{ project: CadFEMProject }> {
  return api(`/api/cad/projects/${projectId}`);
}

export async function listCatalogueSections(): Promise<CatalogueSectionListItem[]> {
  const response = await api<{ sections?: Array<CatalogueSectionListItem & { backendId?: string }> }>('/api/sections');
  return (response.sections || []).map((section) => ({
    ...section,
    id: section.backendId || section.id
  }));
}

export async function getCatalogueSectionProfile(sectionId: string): Promise<CatalogueSectionSnapshot> {
  const response = await api<{ section?: { solidProfile?: CatalogueSectionSnapshot | null } }>(
    `/api/sections/${encodeURIComponent(sectionId)}/preview`
  );
  if (!response.section?.solidProfile) throw new Error('The selected section does not have complete Solid-mode geometry.');
  return response.section.solidProfile;
}

export function applyCommand(projectId: string, request: CadCommandRequest): Promise<CadCommandResult> {
  return api(`/api/cad/projects/${projectId}/commands`, { method: 'POST', body: JSON.stringify(request) });
}

export function listProjectRevisions(projectId: string): Promise<{ revisions: CadRevisionSummary[] }> {
  return api(`/api/cad/projects/${projectId}/revisions`);
}

export function getProjectRevision(projectId: string, revision: number): Promise<{ project: CadFEMProject }> {
  return api(`/api/cad/projects/${projectId}/revisions/${revision}`);
}

export function solveSketch(
  projectId: string,
  baseRevision: number,
  documentId: string,
  sketch: Sketch
): Promise<SketchSolveResult> {
  return api(`/api/cad/projects/${projectId}/sketches/solve`, {
    method: 'POST',
    body: JSON.stringify({ baseRevision, documentId, sketch })
  });
}

export function createStepImportUpload(
  projectId: string,
  input: { fileName: string; contentType: string; byteLength: number; sha256: string }
): Promise<StepUploadGrant> {
  return api(`/api/cad/projects/${projectId}/imports`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function queueStepImport(
  projectId: string,
  input: { stepArtifactId: string; baseRevision: number; idempotencyKey: string }
): Promise<{ job: JobManifest }> {
  return api(`/api/cad/projects/${projectId}/imports`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function uploadStepArtifact(grant: StepUploadGrant, file: File): Promise<void> {
  const response = await fetch(grant.upload.url, {
    method: grant.upload.method,
    headers: grant.upload.headers,
    body: file
  });
  if (!response.ok) throw new Error(`STEP upload failed with status ${response.status}.`);
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
