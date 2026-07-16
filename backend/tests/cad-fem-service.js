const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { config, requireProductionSecret } = require('../config');

const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'beam-cad-fem-'));
config.env = 'production';
config.sessionSecret = 'x'.repeat(32);
config.allowedOrigins = ['https://beamcalculatorstudio.com'];
config.cadFemDatabaseUrl = '';
config.cadFemDatabaseHost = '';
config.cadFemGatewayToken = '';
assert.doesNotThrow(
  requireProductionSecret,
  'Beam-only production startup must not require optional CAD/FEM staging configuration.'
);
config.storageDir = storage;
config.env = 'test';

const {
  createCadFemProject,
  readCadFemProject,
  applyCadFemCommand,
  queueCadFemJob
} = require('../services/cad-fem-service');

function project(id) {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0.0',
    id,
    revision: 0,
    metadata: { name: 'Solid project', description: '', engineer: '', organisation: '', createdAt: now, updatedAt: now },
    displayUnits: { length: 'mm', force: 'N', stress: 'MPa', moment: 'N·mm', mass: 'kg' },
    partDocuments: [{ id: randomUUID(), name: 'Part', geometryRevision: 0, sketches: [], features: [], bodies: [] }],
    assembly: { id: randomUUID(), name: 'Assembly', revision: 0, components: [], mates: [] },
    materials: [{ id: randomUUID(), name: 'Steel', elasticModulus: 210000, poissonRatio: 0.3, source: 'user' }],
    studies: []
  };
}

(async () => {
  const ownerId = randomUUID();
  const id = randomUUID();
  await createCadFemProject(ownerId, project(id));
  const commandId = randomUUID();
  const first = await applyCadFemCommand(ownerId, id, {
    commandId,
    baseRevision: 0,
    command: { type: 'renameProject', name: 'Renamed project' }
  });
  assert.equal(first.revision, 1);
  const duplicate = await applyCadFemCommand(ownerId, id, {
    commandId,
    baseRevision: 0,
    command: { type: 'renameProject', name: 'Must not be reapplied' }
  });
  assert.deepEqual(duplicate, first);
  assert.equal((await readCadFemProject(ownerId, id)).metadata.name, 'Renamed project');

  await assert.rejects(
    () => applyCadFemCommand(ownerId, id, {
      commandId: randomUUID(),
      baseRevision: 0,
      command: { type: 'renameProject', name: 'Stale' }
    }),
    (error) => error.statusCode === 409 && error.code === 'stale_project_revision'
  );
  await assert.rejects(
    () => queueCadFemJob(ownerId, randomUUID(), 'mesh', { idempotencyKey: randomUUID() }),
    (error) => error.statusCode === 503 && error.code === 'native_compute_unavailable'
  );
  fs.rmSync(storage, { recursive: true, force: true });
  console.log('cad/fem service contract ok', {
    immutableRevision: first.revision,
    noSolverFallback: true,
    beamOnlyProductionStartupPreserved: true
  });
})().catch((error) => {
  fs.rmSync(storage, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
});
