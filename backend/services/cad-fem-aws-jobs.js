'use strict';

const { createHash, randomUUID } = require('crypto');
const {
  BatchClient,
  DescribeJobsCommand,
  SubmitJobCommand,
  TerminateJobCommand
} = require('@aws-sdk/client-batch');
const {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { config } = require('../config');
const repository = require('./cad-fem-postgres-repository');

const SOLVER_VERSIONS = {
  platform: '0.1.0',
  occt: 'a016080bf6738d6aeae020badee4e888ad1540a5',
  netgen: 'a3e08f0ec196b442f7de3b9b717ab86c6993f1ab',
  mfem: 'd9d6526cc1749980a2ba1da16e2c1ca1e07d82ec',
  tribol: 'ab6ac57daf1a9dd8a8ffd3b4250b883ecbecec47',
  ceres: '2.2.0'
};

let batchClient;
let s3Client;

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function available() {
  return Boolean(
    config.cadFemBatchJobQueue &&
    config.cadFemBatchJobDefinition &&
    config.cadFemR2Endpoint &&
    config.cadFemR2Bucket &&
    config.cadFemR2AccessKeyId &&
    config.cadFemR2SecretAccessKey &&
    (config.cadFemDatabaseUrl || config.cadFemDatabaseHost)
  );
}

function requireAvailable() {
  if (!available()) {
    throw httpError(503, 'aws_native_compute_unconfigured', 'AWS Batch and R2 native compute are not fully configured.');
  }
}

function batch() {
  requireAvailable();
  batchClient ||= new BatchClient({ region: config.cadFemAwsRegion });
  return batchClient;
}

function s3() {
  requireAvailable();
  s3Client ||= new S3Client({
    region: 'auto',
    endpoint: config.cadFemR2Endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.cadFemR2AccessKeyId,
      secretAccessKey: config.cadFemR2SecretAccessKey
    }
  });
  return s3Client;
}

function safeFilename(value) {
  const filename = String(value || 'model.step')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return filename.toLowerCase().endsWith('.step') || filename.toLowerCase().endsWith('.stp')
    ? filename
    : `${filename || 'model'}.step`;
}

function copySource(bucket, key) {
  return `${bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`;
}

async function objectJson(key) {
  const response = await s3().send(new GetObjectCommand({
    Bucket: config.cadFemR2Bucket,
    Key: key
  }));
  return JSON.parse(await response.Body.transformToString());
}

async function createImportUpload(ownerId, projectId, body) {
  requireAvailable();
  await repository.readProject(ownerId, projectId);
  const contentType = String(body?.contentType || 'application/step');
  const byteLength = Number(body?.byteLength);
  const sha256 = String(body?.sha256 || '').toLowerCase();
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > 2 * 1024 * 1024 * 1024) {
    throw httpError(422, 'step_size_invalid', 'STEP upload size must be between 1 byte and 2 GiB.');
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw httpError(422, 'step_hash_invalid', 'A lowercase hexadecimal SHA-256 digest is required.');
  }
  const id = randomUUID();
  const filename = safeFilename(body?.fileName);
  const objectKey = `projects/${projectId}/imports/${id}/${filename}`;
  const artifact = await repository.createArtifact(ownerId, {
    id,
    projectId,
    kind: 'step',
    bucket: config.cadFemR2Bucket,
    objectKey,
    contentType,
    byteLength,
    sha256
  });
  const command = new PutObjectCommand({
    Bucket: config.cadFemR2Bucket,
    Key: objectKey,
    ContentType: contentType,
    Metadata: {
      sha256,
      projectid: projectId,
      artifactid: id
    }
  });
  const expiresIn = 15 * 60;
  return {
    artifact,
    upload: {
      method: 'PUT',
      url: await getSignedUrl(s3(), command, { expiresIn }),
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
    }
  };
}

async function verifiedStepArtifact(ownerId, projectId, artifactId) {
  const artifact = await repository.readArtifact(ownerId, artifactId);
  if (artifact.projectId !== projectId || artifact.kind !== 'step') {
    throw httpError(422, 'step_artifact_invalid', 'The selected STEP artifact does not belong to this project.');
  }
  let head;
  try {
    head = await s3().send(new HeadObjectCommand({
      Bucket: artifact.bucket,
      Key: artifact.objectKey
    }));
  } catch {
    throw httpError(409, 'step_upload_incomplete', 'The STEP artifact has not been uploaded.');
  }
  if (Number(head.ContentLength) !== Number(artifact.byteLength) ||
      String(head.Metadata?.sha256 || '').toLowerCase() !== artifact.sha256) {
    throw httpError(409, 'step_upload_mismatch', 'The uploaded STEP object does not match its immutable manifest.');
  }
  return artifact;
}

function immutableInputHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function stageAndSubmit(ownerId, job, stepArtifact, inputManifest) {
  const inputPrefix = `jobs/${job.id}/input`;
  const outputPrefix = `jobs/${job.id}/output`;
  try {
    if (stepArtifact) {
      await s3().send(new CopyObjectCommand({
        Bucket: config.cadFemR2Bucket,
        Key: `${inputPrefix}/model.step`,
        CopySource: copySource(stepArtifact.bucket, stepArtifact.objectKey),
        MetadataDirective: 'COPY'
      }));
    }
    await s3().send(new PutObjectCommand({
      Bucket: config.cadFemR2Bucket,
      Key: `${inputPrefix}/job-input.json`,
      ContentType: 'application/json',
      Body: JSON.stringify(inputManifest)
    }));
    const submitted = await batch().send(new SubmitJobCommand({
      jobName: `cad-fem-${job.kind}-${job.id}`.slice(0, 128),
      jobQueue: config.cadFemBatchJobQueue,
      jobDefinition: config.cadFemBatchJobDefinition,
      containerOverrides: {
        environment: [
          { name: 'CAD_FEM_JOB_ID', value: job.id },
          { name: 'CAD_FEM_JOB_KIND', value: job.kind },
          { name: 'CAD_FEM_INPUT_PREFIX', value: inputPrefix },
          { name: 'CAD_FEM_OUTPUT_PREFIX', value: outputPrefix }
        ]
      },
      timeout: { attemptDurationSeconds: 7200 },
      retryStrategy: { attempts: 1 },
      tags: {
        Application: 'BeamCalculatorStudio',
        Environment: 'staging',
        ProjectId: job.projectId,
        JobId: job.id
      }
    }));
    return repository.attachAwsJob(ownerId, job.id, submitted.jobId);
  } catch (error) {
    await repository.updateJob(ownerId, job.id, {
      stage: 'failed',
      progress: 1,
      diagnostics: [{
        severity: 'error',
        code: 'batch_submission_failed',
        message: error.message,
        entityIds: [job.id]
      }]
    });
    throw error;
  }
}

async function queueImportJob(ownerId, projectId, body) {
  requireAvailable();
  const project = await repository.readProject(ownerId, projectId);
  if (!Number.isInteger(body?.baseRevision) || body.baseRevision !== project.revision) {
    throw httpError(409, 'stale_project_revision', `Project is at revision ${project.revision}; import was based on ${String(body?.baseRevision)}.`);
  }
  const stepArtifact = await verifiedStepArtifact(ownerId, projectId, body.stepArtifactId);
  const inputManifest = {
    apiVersion: '1.0.0',
    projectId,
    projectRevision: project.revision,
    geometryRevision: Math.max(0, ...project.partDocuments.map(({ geometryRevision = 0 }) => geometryRevision)),
    stepArtifactId: stepArtifact.id
  };
  const inputHash = immutableInputHash(inputManifest);
  const job = await repository.createJob(ownerId, {
    id: randomUUID(),
    projectId,
    kind: 'stepImport',
    idempotencyKey: String(body.idempotencyKey),
    inputHash,
    inputManifest,
    solverVersions: SOLVER_VERSIONS
  });
  if (job.awsJobId || ['complete', 'failed', 'cancelled'].includes(job.stage)) return { job };
  return { job: await stageAndSubmit(ownerId, job, stepArtifact, inputManifest) };
}

function catalogueExtrusionForMeshing(project) {
  const features = (project.partDocuments || []).flatMap(({ features = [] }) => features)
    .filter(({ type, suppressed }) => type === 'catalogueExtrusion' && !suppressed);
  if (features.length === 0) return null;
  if (features.length !== 1) {
    throw httpError(
      422,
      'catalogue_assembly_meshing_not_released',
      'The current catalogue meshing path accepts one unsuppressed EC3 section extrusion. Multi-body assembly meshing is not yet released.'
    );
  }
  const feature = features[0];
  if (feature.section?.catalogue !== 'beam-ec3' || feature.section?.geometryVerified !== true ||
      !/^[a-f0-9]{64}$/.test(String(feature.section?.catalogueRevision || '')) ||
      !(Number(feature.length) > 0)) {
    throw httpError(422, 'catalogue_extrusion_invalid', 'The project does not contain a valid verified EC3 catalogue extrusion snapshot.');
  }
  return structuredClone(feature);
}

async function queueStudyJob(ownerId, studyId, kind, body) {
  requireAvailable();
  const record = await repository.readStudy(ownerId, studyId);
  const project = await repository.readProject(ownerId, record.project_id);
  if (body.projectId !== record.project_id ||
      body.projectRevision !== record.current_revision ||
      body.geometryRevision !== record.current_geometry_revision) {
    throw httpError(409, 'stale_study_input', 'The submitted study does not match the current project geometry revision.');
  }
  const artifactId = Array.isArray(body.artifactIds) ? body.artifactIds[0] : '';
  const stepArtifact = artifactId
    ? await verifiedStepArtifact(ownerId, record.project_id, artifactId)
    : null;
  const catalogueExtrusion = stepArtifact ? null : catalogueExtrusionForMeshing(project);
  if (!stepArtifact && !catalogueExtrusion) {
    throw httpError(422, 'geometry_input_required', 'A verified STEP artifact or one saved EC3 catalogue extrusion is required for native meshing.');
  }
  const study = record.study;
  const inputManifest = {
    apiVersion: '1.0.0',
    projectId: record.project_id,
    studyId,
    projectRevision: record.current_revision,
    geometryRevision: record.current_geometry_revision,
    mesh: study.mesh,
    solver: study.solver,
    ...(catalogueExtrusion ? { catalogueExtrusion } : {})
  };
  if (kind === 'solve') {
    if (!stepArtifact) {
      throw httpError(
        422,
        'native_profile_not_released',
        'Catalogue sections can enter native regeneration and meshing, but arbitrary solid solves remain disabled until their benchmarks pass.'
      );
    }
    if (body.settings?.verificationProfile !== 'axialBarX') {
      throw httpError(
        422,
        'native_profile_not_released',
        'The current native spike only accepts the automated axial-bar verification profile; arbitrary solid solves are not released.'
      );
    }
    if (!/^[a-f0-9]{64}$/.test(config.cadFemVerificationStepSha256)) {
      throw httpError(
        503,
        'verification_fixture_unconfigured',
        'The approved axial-bar STEP fixture hash is not configured.'
      );
    }
    if (stepArtifact.sha256 !== config.cadFemVerificationStepSha256) {
      throw httpError(
        422,
        'verification_fixture_mismatch',
        'The submitted STEP artifact is not the approved axial-bar verification fixture.'
      );
    }
    const assignment = study.materialAssignments[0];
    const material = project.materials.find(({ id }) => id === assignment?.materialId);
    const load = study.loads.find(({ type }) => type === 'traction');
    if (!material ||
        material.elasticModulus !== 210000 ||
        material.poissonRatio !== 0.3 ||
        !load ||
        load.vector[0] !== 1 ||
        load.vector[1] !== 0 ||
        load.vector[2] !== 0 ||
        study.mesh.elementOrder !== 2 ||
        study.mesh.globalSize !== 40 ||
        study.mesh.minimumSize !== 4) {
      throw httpError(
        422,
        'axial_bar_profile_invalid',
        'The axial-bar profile requires the approved material, traction and converged-mesh settings.'
      );
    }
    inputManifest.verificationProfile = 'axialBarX';
    inputManifest.material = material;
    inputManifest.load = { traction: load.vector };
  }
  const inputHash = immutableInputHash(inputManifest);
  const job = await repository.createJob(ownerId, {
    id: randomUUID(),
    projectId: record.project_id,
    studyId,
    kind,
    idempotencyKey: String(body.idempotencyKey),
    inputHash,
    inputManifest,
    solverVersions: SOLVER_VERSIONS
  });
  if (job.awsJobId || ['complete', 'failed', 'cancelled'].includes(job.stage)) return { job };
  return { job: await stageAndSubmit(ownerId, job, stepArtifact, inputManifest) };
}

function mappedBatchStage(kind, status) {
  if (['SUBMITTED', 'PENDING', 'RUNNABLE'].includes(status)) return ['queued', 0.05];
  if (status === 'STARTING') return ['preparing', 0.15];
  if (status === 'RUNNING') {
    if (kind === 'stepImport') return ['regenerating', 0.55];
    if (kind === 'mesh') return ['meshing', 0.55];
    return ['solving', 0.6];
  }
  if (status === 'FAILED') return ['failed', 1];
  return [null, null];
}

async function registerOutputArtifacts(ownerId, job, artifactsManifest) {
  const references = [];
  for (const item of artifactsManifest.artifacts || []) {
    const artifact = await repository.createArtifact(ownerId, {
      id: randomUUID(),
      projectId: job.projectId,
      jobId: job.id,
      kind: item.kind,
      bucket: config.cadFemR2Bucket,
      objectKey: `jobs/${job.id}/output/${item.path}`,
      contentType: item.contentType,
      byteLength: item.byteLength,
      sha256: item.sha256
    });
    references.push({
      id: artifact.id,
      kind: artifact.kind,
      contentType: artifact.contentType,
      byteLength: Number(artifact.byteLength),
      sha256: artifact.sha256
    });
  }
  return references;
}

async function getJob(ownerId, jobId) {
  let job = await repository.getJob(ownerId, jobId);
  if (!job.awsJobId || ['complete', 'failed', 'cancelled'].includes(job.stage)) return { job };
  const described = await batch().send(new DescribeJobsCommand({ jobs: [job.awsJobId] }));
  const remote = described.jobs?.[0];
  if (!remote) {
    return {
      job: await repository.updateJob(ownerId, jobId, {
        stage: 'failed',
        progress: 1,
        diagnostics: [{ severity: 'error', code: 'batch_job_missing', message: 'AWS Batch no longer reports this job.', entityIds: [jobId] }]
      })
    };
  }
  if (remote.status === 'SUCCEEDED') {
    try {
      const status = await objectJson(`jobs/${jobId}/output/job-status.json`);
      if (status.stage !== 'complete' ||
          status.succeeded !== true ||
          (job.kind === 'solve' && status.converged !== true)) {
        throw new Error(status.message || 'Native executable did not report a successful completion.');
      }
      const artifactsManifest = await objectJson(`jobs/${jobId}/output/artifacts.json`);
      const artifacts = await registerOutputArtifacts(ownerId, job, artifactsManifest);
      let nativeResult = {};
      try {
        nativeResult = await objectJson(`jobs/${jobId}/output/result.json`);
      } catch {
        nativeResult = {};
      }
      job = await repository.updateJob(ownerId, jobId, {
        stage: 'complete',
        progress: 1,
        solverVersions: SOLVER_VERSIONS,
        result: {
          ...nativeResult,
          ...(job.kind === 'solve' ? { converged: true } : {}),
          artifacts
        }
      });
      return { job };
    } catch (error) {
      job = await repository.updateJob(ownerId, jobId, {
        stage: 'failed',
        progress: 1,
        diagnostics: [{ severity: 'error', code: 'native_result_invalid', message: error.message, entityIds: [jobId] }]
      });
      return { job };
    }
  }
  const [stage, progress] = mappedBatchStage(job.kind, remote.status);
  if (stage) {
    job = await repository.updateJob(ownerId, jobId, {
      stage,
      progress,
      diagnostics: remote.statusReason ? [{
        severity: stage === 'failed' ? 'error' : 'info',
        code: `aws_batch_${String(remote.status).toLowerCase()}`,
        message: remote.statusReason,
        entityIds: [jobId]
      }] : undefined
    });
  }
  return { job };
}

async function cancelJob(ownerId, jobId) {
  let job = await repository.requestJobCancellation(ownerId, jobId);
  if (job.awsJobId && !['complete', 'failed', 'cancelled'].includes(job.stage)) {
    await batch().send(new TerminateJobCommand({
      jobId: job.awsJobId,
      reason: 'Cancellation requested by the authenticated project owner.'
    }));
    job = await repository.updateJob(ownerId, jobId, {
      stage: 'cancelled',
      progress: 1,
      diagnostics: [{ severity: 'info', code: 'job_cancelled', message: 'Job cancellation was sent to AWS Batch.', entityIds: [jobId] }]
    });
  }
  return { job };
}

async function eventsResponse(ownerId, jobId) {
  const { job } = await getJob(ownerId, jobId);
  return new Response(`id: ${Date.now()}\nevent: job\ndata: ${JSON.stringify(job)}\n\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive'
    }
  });
}

async function artifactResponse(ownerId, jobId, artifactId) {
  const artifact = await repository.readJobArtifact(ownerId, jobId, artifactId);
  const url = await getSignedUrl(s3(), new GetObjectCommand({
    Bucket: artifact.bucket,
    Key: artifact.objectKey,
    ResponseContentType: artifact.contentType
  }), { expiresIn: 5 * 60 });
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      'Cache-Control': 'private, no-store'
    }
  });
}

module.exports = {
  available,
  catalogueExtrusionForMeshing,
  createImportUpload,
  queueImportJob,
  queueStudyJob,
  getJob,
  cancelJob,
  eventsResponse,
  artifactResponse
};
