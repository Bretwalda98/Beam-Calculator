'use strict';

const fs = require('fs');
const { createHash } = require('crypto');
const { Pool } = require('pg');
const { config } = require('../config');

let pool;

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function getPool() {
  if (!config.cadFemDatabaseUrl && !config.cadFemDatabaseHost) {
    throw httpError(503, 'cad_fem_repository_unconfigured', 'CAD/FEM PostgreSQL persistence is not configured.');
  }
  pool ||= new Pool({
    ...(config.cadFemDatabaseUrl ? {
      connectionString: config.cadFemDatabaseUrl
    } : {
      host: config.cadFemDatabaseHost,
      port: config.cadFemDatabasePort,
      database: config.cadFemDatabaseName,
      user: config.cadFemDatabaseUser,
      password: config.cadFemDatabasePassword
    }),
    max: Number(process.env.CAD_FEM_DATABASE_POOL_SIZE || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    ssl: databaseSsl()
  });
  return pool;
}

function databaseSsl() {
  if (!config.cadFemDatabaseSsl) return false;
  return {
    rejectUnauthorized: true,
    ...(config.cadFemDatabaseCaPath
      ? { ca: fs.readFileSync(config.cadFemDatabaseCaPath, 'utf8') }
      : {})
  };
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function withTransaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resolveGatewayIdentity({ email, subject, name = '' }) {
  if (!email || !subject) {
    throw httpError(401, 'gateway_identity_invalid', 'The trusted gateway identity is incomplete.');
  }
  return withTransaction(async (client) => {
    const existingIdentity = await client.query(
      `SELECT users.id, users.email, users.display_name AS name
         FROM user_identities identity
         JOIN users ON users.id = identity.user_id
        WHERE identity.provider = 'cloudflare-access' AND identity.subject = $1
        FOR UPDATE OF identity`,
      [subject]
    );
    if (existingIdentity.rowCount) {
      await client.query(
        `UPDATE user_identities
            SET email = $2, last_seen_at = now()
          WHERE provider = 'cloudflare-access' AND subject = $1`,
        [subject, email]
      );
      return existingIdentity.rows[0];
    }

    let user = await client.query(
      'SELECT id, email, display_name AS name FROM users WHERE email = $1 FOR UPDATE',
      [email]
    );
    if (!user.rowCount) {
      user = await client.query(
        `INSERT INTO users
          (email, display_name, auth_provider, auth_subject)
         VALUES ($1, $2, 'cloudflare-access', $3)
         RETURNING id, email, display_name AS name`,
        [email, name || null, subject]
      );
    }
    await client.query(
      `INSERT INTO user_identities (provider, subject, user_id, email)
       VALUES ('cloudflare-access', $1, $2, $3)`,
      [subject, user.rows[0].id, email]
    );
    return user.rows[0];
  });
}

async function listProjects(ownerId) {
  const result = await getPool().query(
    `SELECT id, name, current_revision AS revision,
            current_geometry_revision AS "geometryRevision",
            updated_at AS "updatedAt"
       FROM cad_fem_projects
      WHERE owner_user_id = $1 AND archived_at IS NULL
      ORDER BY updated_at DESC`,
    [ownerId]
  );
  return result.rows;
}

async function createProject(ownerId, project) {
  return withTransaction(async (client) => {
    try {
      await client.query(
        `INSERT INTO cad_fem_projects
          (id, owner_user_id, name, schema_version, current_revision, current_geometry_revision,
           created_at, updated_at)
         VALUES ($1, $2, $3, $4, 0, $5, $6, $6)`,
        [
          project.id,
          ownerId,
          project.metadata.name,
          project.schemaVersion,
          Math.max(0, ...project.partDocuments.map(({ geometryRevision = 0 }) => geometryRevision)),
          project.metadata.createdAt
        ]
      );
      await client.query(
        `INSERT INTO cad_fem_project_revisions
          (project_id, revision_number, geometry_revision, project_json, project_sha256,
           created_by, created_at)
         VALUES ($1, 0, $2, $3::jsonb, $4, $5, $6)`,
        [
          project.id,
          Math.max(0, ...project.partDocuments.map(({ geometryRevision = 0 }) => geometryRevision)),
          JSON.stringify(project),
          sha256(project),
          ownerId,
          project.metadata.createdAt
        ]
      );
      await persistStudies(client, ownerId, project);
      return project;
    } catch (error) {
      if (error.code === '23505') {
        throw httpError(409, 'cad_fem_project_exists', 'A CAD/FEM project with this ID already exists.');
      }
      throw error;
    }
  });
}

async function readProject(ownerId, projectId, client = getPool()) {
  const result = await client.query(
    `SELECT revision.project_json AS project
       FROM cad_fem_projects project
       JOIN cad_fem_project_revisions revision
         ON revision.project_id = project.id
        AND revision.revision_number = project.current_revision
      WHERE project.id = $1 AND project.owner_user_id = $2 AND project.archived_at IS NULL`,
    [projectId, ownerId]
  );
  if (!result.rowCount) {
    throw httpError(404, 'cad_fem_project_not_found', 'CAD/FEM project not found.');
  }
  return result.rows[0].project;
}

async function listProjectRevisions(ownerId, projectId) {
  const result = await getPool().query(
    `SELECT revision.revision_number AS revision,
            revision.geometry_revision AS "geometryRevision",
            revision.command_id AS "commandId",
            command.command_json->>'type' AS "commandType",
            CASE WHEN command.command_json->>'type' = 'restoreRevision'
                 THEN (command.command_json->>'targetRevision')::integer
                 ELSE NULL END AS "targetRevision",
            revision.created_at AS "createdAt"
       FROM cad_fem_projects project
       JOIN cad_fem_project_revisions revision ON revision.project_id = project.id
       LEFT JOIN cad_fem_commands command
         ON command.id = revision.command_id
        AND command.project_id = revision.project_id
        AND command.owner_user_id = project.owner_user_id
      WHERE project.id = $1
        AND project.owner_user_id = $2
        AND project.archived_at IS NULL
      ORDER BY revision.revision_number ASC`,
    [projectId, ownerId]
  );
  if (!result.rowCount) {
    const project = await getPool().query(
      'SELECT 1 FROM cad_fem_projects WHERE id = $1 AND owner_user_id = $2 AND archived_at IS NULL',
      [projectId, ownerId]
    );
    if (!project.rowCount) throw httpError(404, 'cad_fem_project_not_found', 'CAD/FEM project not found.');
  }
  return result.rows.map((row) => ({
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt
  }));
}

async function readProjectRevision(ownerId, projectId, revisionNumber) {
  const result = await getPool().query(
    `SELECT revision.project_json AS project
       FROM cad_fem_projects project
       JOIN cad_fem_project_revisions revision ON revision.project_id = project.id
      WHERE project.id = $1
        AND project.owner_user_id = $2
        AND project.archived_at IS NULL
        AND revision.revision_number = $3`,
    [projectId, ownerId, revisionNumber]
  );
  if (!result.rowCount) {
    throw httpError(404, 'cad_fem_revision_not_found', `CAD/FEM project revision ${revisionNumber} was not found.`);
  }
  return result.rows[0].project;
}

async function persistStudies(client, ownerId, project) {
  const studyIds = [];
  for (const study of project.studies) {
    studyIds.push(study.id);
    await client.query(
      `INSERT INTO cad_fem_studies
        (id, project_id, owner_user_id, name, geometry_revision, study_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         geometry_revision = EXCLUDED.geometry_revision,
         study_json = EXCLUDED.study_json,
         updated_at = EXCLUDED.updated_at
       WHERE cad_fem_studies.owner_user_id = EXCLUDED.owner_user_id
         AND cad_fem_studies.project_id = EXCLUDED.project_id`,
      [
        study.id,
        project.id,
        ownerId,
        study.name,
        study.geometryRevision,
        JSON.stringify(study),
        project.metadata.updatedAt
      ]
    );
  }
  if (studyIds.length) {
    await client.query(
      `DELETE FROM cad_fem_studies
        WHERE project_id = $1 AND owner_user_id = $2 AND NOT (id = ANY($3::uuid[]))`,
      [project.id, ownerId, studyIds]
    );
  } else {
    await client.query(
      'DELETE FROM cad_fem_studies WHERE project_id = $1 AND owner_user_id = $2',
      [project.id, ownerId]
    );
  }
}

async function applyCommand(ownerId, projectId, request, transform) {
  return withTransaction(async (client) => {
    const duplicate = await client.query(
      `SELECT result_json AS result
         FROM cad_fem_commands
        WHERE id = $1 AND project_id = $2 AND owner_user_id = $3`,
      [request.commandId, projectId, ownerId]
    );
    if (duplicate.rowCount && duplicate.rows[0].result) {
      return duplicate.rows[0].result;
    }

    const current = await client.query(
      `SELECT project.current_revision AS revision,
              revision.project_json AS project_json
         FROM cad_fem_projects project
         JOIN cad_fem_project_revisions revision
           ON revision.project_id = project.id
          AND revision.revision_number = project.current_revision
        WHERE project.id = $1 AND project.owner_user_id = $2 AND project.archived_at IS NULL
        FOR UPDATE OF project`,
      [projectId, ownerId]
    );
    if (!current.rowCount) {
      throw httpError(404, 'cad_fem_project_not_found', 'CAD/FEM project not found.');
    }
    if (current.rows[0].revision !== request.baseRevision) {
      throw httpError(
        409,
        'stale_project_revision',
        `Project is at revision ${current.rows[0].revision}; command was based on ${request.baseRevision}.`
      );
    }

    const project = current.rows[0].project_json;
    const result = transform(project);
    try {
      await client.query(
        `INSERT INTO cad_fem_commands
          (id, project_id, owner_user_id, base_revision, command_json, command_sha256,
           result_json, completed_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, now())`,
        [
          request.commandId,
          projectId,
          ownerId,
          request.baseRevision,
          JSON.stringify(request.command),
          sha256(request.command),
          JSON.stringify(result)
        ]
      );
    } catch (error) {
      if (error.code === '23505') {
        const concurrent = await client.query(
          'SELECT result_json AS result FROM cad_fem_commands WHERE id = $1 AND owner_user_id = $2',
          [request.commandId, ownerId]
        );
        if (concurrent.rowCount && concurrent.rows[0].result) return concurrent.rows[0].result;
      }
      throw error;
    }

    await client.query(
      `INSERT INTO cad_fem_project_revisions
        (project_id, revision_number, geometry_revision, command_id, project_json,
         project_sha256, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        projectId,
        project.revision,
        result.geometryRevision,
        request.commandId,
        JSON.stringify(project),
        sha256(project),
        ownerId,
        project.metadata.updatedAt
      ]
    );
    await client.query(
      `UPDATE cad_fem_projects
          SET name = $3,
              current_revision = $4,
              current_geometry_revision = $5,
              updated_at = $6
        WHERE id = $1 AND owner_user_id = $2`,
      [
        projectId,
        ownerId,
        project.metadata.name,
        project.revision,
        result.geometryRevision,
        project.metadata.updatedAt
      ]
    );
    await persistStudies(client, ownerId, project);
    return result;
  });
}

function jobManifest(row) {
  return {
    apiVersion: '1.0.0',
    id: row.id,
    projectId: row.project_id,
    studyId: row.study_id || undefined,
    kind: row.kind,
    stage: row.stage,
    progress: Number(row.progress),
    inputHash: row.input_hash,
    idempotencyKey: row.idempotency_key,
    requestedAt: row.requested_at instanceof Date ? row.requested_at.toISOString() : row.requested_at,
    startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at || undefined,
    completedAt: row.completed_at instanceof Date ? row.completed_at.toISOString() : row.completed_at || undefined,
    cancellationRequested: row.cancellation_requested,
    diagnostics: row.diagnostics || [],
    artifacts: row.result_manifest?.artifacts || [],
    solverVersions: row.solver_versions || {},
    awsJobId: row.aws_job_id || undefined,
    result: row.result_manifest || undefined
  };
}

async function readStudy(ownerId, studyId) {
  const result = await getPool().query(
    `SELECT study.study_json AS study,
            study.project_id,
            project.current_revision,
            project.current_geometry_revision
       FROM cad_fem_studies study
       JOIN cad_fem_projects project ON project.id = study.project_id
      WHERE study.id = $1
        AND study.owner_user_id = $2
        AND project.owner_user_id = $2
        AND project.archived_at IS NULL`,
    [studyId, ownerId]
  );
  if (!result.rowCount) {
    throw httpError(404, 'cad_fem_study_not_found', 'CAD/FEM study not found.');
  }
  return result.rows[0];
}

async function createJob(ownerId, job) {
  return withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT * FROM cad_fem_jobs
        WHERE owner_user_id = $1 AND idempotency_key = $2
        FOR UPDATE`,
      [ownerId, job.idempotencyKey]
    );
    if (existing.rowCount) {
      if (existing.rows[0].input_hash !== job.inputHash) {
        throw httpError(409, 'idempotency_key_reused', 'The idempotency key was already used for different job input.');
      }
      return jobManifest(existing.rows[0]);
    }
    await client.query(
      `INSERT INTO cad_fem_jobs
        (id, owner_user_id, project_id, study_id, kind, stage, progress,
         idempotency_key, input_hash, input_manifest, diagnostics, solver_versions)
       VALUES ($1, $2, $3, $4, $5, 'queued', 0, $6, $7, $8::jsonb, '[]', $9::jsonb)`,
      [
        job.id,
        ownerId,
        job.projectId,
        job.studyId || null,
        job.kind,
        job.idempotencyKey,
        job.inputHash,
        JSON.stringify(job.inputManifest),
        JSON.stringify(job.solverVersions || {})
      ]
    );
    const created = await client.query('SELECT * FROM cad_fem_jobs WHERE id = $1', [job.id]);
    return jobManifest(created.rows[0]);
  });
}

async function attachAwsJob(ownerId, jobId, awsJobId) {
  const result = await getPool().query(
    `UPDATE cad_fem_jobs
        SET aws_job_id = $3, stage = 'preparing', progress = 0.05, started_at = now()
      WHERE id = $1 AND owner_user_id = $2
      RETURNING *`,
    [jobId, ownerId, awsJobId]
  );
  if (!result.rowCount) throw httpError(404, 'cad_fem_job_not_found', 'CAD/FEM job not found.');
  return jobManifest(result.rows[0]);
}

async function getJob(ownerId, jobId) {
  const result = await getPool().query(
    'SELECT * FROM cad_fem_jobs WHERE id = $1 AND owner_user_id = $2',
    [jobId, ownerId]
  );
  if (!result.rowCount) throw httpError(404, 'cad_fem_job_not_found', 'CAD/FEM job not found.');
  return jobManifest(result.rows[0]);
}

async function updateJob(ownerId, jobId, update) {
  const result = await getPool().query(
    `UPDATE cad_fem_jobs
        SET stage = COALESCE($3, stage),
            progress = COALESCE($4, progress),
            diagnostics = COALESCE($5::jsonb, diagnostics),
            result_manifest = COALESCE($6::jsonb, result_manifest),
            solver_versions = COALESCE($7::jsonb, solver_versions),
            completed_at = CASE WHEN $3 IN ('complete', 'failed', 'cancelled') THEN now() ELSE completed_at END
      WHERE id = $1 AND owner_user_id = $2
      RETURNING *`,
    [
      jobId,
      ownerId,
      update.stage || null,
      update.progress ?? null,
      update.diagnostics ? JSON.stringify(update.diagnostics) : null,
      update.result ? JSON.stringify(update.result) : null,
      update.solverVersions ? JSON.stringify(update.solverVersions) : null
    ]
  );
  if (!result.rowCount) throw httpError(404, 'cad_fem_job_not_found', 'CAD/FEM job not found.');
  return jobManifest(result.rows[0]);
}

async function requestJobCancellation(ownerId, jobId) {
  const result = await getPool().query(
    `UPDATE cad_fem_jobs
        SET cancellation_requested = true
      WHERE id = $1 AND owner_user_id = $2
      RETURNING *`,
    [jobId, ownerId]
  );
  if (!result.rowCount) throw httpError(404, 'cad_fem_job_not_found', 'CAD/FEM job not found.');
  return jobManifest(result.rows[0]);
}

async function createArtifact(ownerId, artifact) {
  const inserted = await getPool().query(
    `INSERT INTO cad_fem_artifacts
      (id, owner_user_id, project_id, job_id, kind, bucket, object_key,
       content_type, byte_length, sha256, immutable)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
     ON CONFLICT (bucket, object_key) DO NOTHING`,
    [
      artifact.id,
      ownerId,
      artifact.projectId,
      artifact.jobId || null,
      artifact.kind,
      artifact.bucket,
      artifact.objectKey,
      artifact.contentType,
      artifact.byteLength,
      artifact.sha256
    ]
  );
  if (!inserted.rowCount) {
    const existing = await getPool().query(
      `SELECT id, project_id AS "projectId", job_id AS "jobId", kind, bucket,
              object_key AS "objectKey", content_type AS "contentType",
              byte_length AS "byteLength", sha256
         FROM cad_fem_artifacts
        WHERE bucket = $1 AND object_key = $2 AND owner_user_id = $3`,
      [artifact.bucket, artifact.objectKey, ownerId]
    );
    if (existing.rowCount) return existing.rows[0];
  }
  return artifact;
}

async function readArtifact(ownerId, artifactId) {
  const result = await getPool().query(
    `SELECT id, project_id AS "projectId", job_id AS "jobId", kind, bucket,
            object_key AS "objectKey", content_type AS "contentType",
            byte_length AS "byteLength", sha256
       FROM cad_fem_artifacts
      WHERE id = $1 AND owner_user_id = $2`,
    [artifactId, ownerId]
  );
  if (!result.rowCount) throw httpError(404, 'cad_fem_artifact_not_found', 'CAD/FEM artifact not found.');
  return result.rows[0];
}

async function readJobArtifact(ownerId, jobId, artifactId) {
  const artifact = await readArtifact(ownerId, artifactId);
  if (artifact.jobId !== jobId) {
    throw httpError(404, 'cad_fem_artifact_not_found', 'CAD/FEM artifact not found.');
  }
  return artifact;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = {
  listProjects,
  createProject,
  readProject,
  listProjectRevisions,
  readProjectRevision,
  applyCommand,
  readStudy,
  createJob,
  attachAwsJob,
  getJob,
  updateJob,
  requestJobCancellation,
  createArtifact,
  readArtifact,
  readJobArtifact,
  resolveGatewayIdentity,
  closePool
};
