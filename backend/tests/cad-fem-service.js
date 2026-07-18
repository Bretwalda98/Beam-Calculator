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
const { catalogueExtrusionForMeshing } = require('../services/cad-fem-aws-jobs');

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

  const catalogueCommandId = randomUUID();
  const storedBeforeCatalogue = await readCadFemProject(ownerId, id);
  const catalogueResult = await applyCadFemCommand(ownerId, id, {
    commandId: catalogueCommandId,
    baseRevision: storedBeforeCatalogue.revision,
    command: {
      type: 'appendCatalogueExtrusion',
      documentId: storedBeforeCatalogue.partDocuments[0].id,
      featureId: randomUUID(),
      bodyId: randomUUID(),
      componentId: randomUUID(),
      sectionId: 'UB|UB 914x419x388',
      length: 3000
    }
  });
  assert.equal(catalogueResult.revision, 2);
  const withCatalogue = await readCadFemProject(ownerId, id);
  const catalogueFeature = withCatalogue.partDocuments[0].features[0];
  assert.equal(catalogueFeature.type, 'catalogueExtrusion');
  assert.equal(catalogueFeature.section.catalogue, 'beam-ec3');
  assert.match(catalogueFeature.section.catalogueRevision, /^[a-f0-9]{64}$/);
  assert.equal(catalogueFeature.section.properties.area, 49400);
  assert.equal(withCatalogue.assembly.components.length, 1);
  const meshingFeature = catalogueExtrusionForMeshing(withCatalogue);
  assert.equal(meshingFeature.section.sectionId, 'UB|UB 914x419x388');
  assert.equal(meshingFeature.length, 3000);
  const duplicateCatalogue = await applyCadFemCommand(ownerId, id, {
    commandId: catalogueCommandId,
    baseRevision: 1,
    command: { type: 'renameProject', name: 'Duplicate command must not execute' }
  });
  assert.deepEqual(duplicateCatalogue, catalogueResult);
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
