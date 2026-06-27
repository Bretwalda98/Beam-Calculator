const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const { config } = require('../config');

function userProjectDir(userId) {
  return path.join(config.storageDir, 'projects', String(userId));
}

function assertProjectId(projectId) {
  if (!/^[a-f0-9-]{36}$/i.test(String(projectId || ''))) {
    const err = new Error('Invalid project id.');
    err.statusCode = 400;
    throw err;
  }
}

async function listProjects(userId) {
  const dir = userProjectDir(userId);
  await fs.mkdir(dir, { recursive: true });
  const files = await fs.readdir(dir);
  const projects = [];
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const data = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
    projects.push({
      id: data.id,
      name: data.name,
      revision: data.currentRevision,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      archived: Boolean(data.archived)
    });
  }
  return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

async function readProject(userId, projectId) {
  assertProjectId(projectId);
  const file = path.join(userProjectDir(userId), `${projectId}.json`);
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  if (data.ownerId !== userId) {
    const err = new Error('Project not found.');
    err.statusCode = 404;
    throw err;
  }
  return data;
}

async function saveProject(userId, body) {
  const now = new Date().toISOString();
  const id = body.id || randomUUID();
  assertProjectId(id);
  const dir = userProjectDir(userId);
  await fs.mkdir(dir, { recursive: true });
  let existing = null;
  try {
    existing = await readProject(userId, id);
  } catch {
    existing = null;
  }
  const revisionNumber = existing ? (existing.currentRevision || 0) + 1 : 1;
  const project = {
    id,
    ownerId: userId,
    name: String(body.name || existing?.name || 'Untitled beam project').slice(0, 140),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    currentRevision: revisionNumber,
    archived: Boolean(existing?.archived),
    metadata: body.metadata || existing?.metadata || {},
    latestInput: body.input || existing?.latestInput || null,
    latestResult: body.result || existing?.latestResult || null,
    revisions: [
      ...(existing?.revisions || []),
      {
        id: randomUUID(),
        revision: revisionNumber,
        createdAt: now,
        metadata: body.metadata || {},
        input: body.input || null,
        result: body.result || null
      }
    ]
  };
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(project, null, 2), 'utf8');
  return project;
}

async function archiveProject(userId, projectId) {
  const project = await readProject(userId, projectId);
  project.archived = true;
  project.updatedAt = new Date().toISOString();
  await fs.writeFile(path.join(userProjectDir(userId), `${projectId}.json`), JSON.stringify(project, null, 2), 'utf8');
  return project;
}

module.exports = { listProjects, readProject, saveProject, archiveProject };
