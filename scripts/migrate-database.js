'use strict';

const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
const { Client } = require('pg');
const { config } = require('../backend/config');

function databaseOptions() {
  const ssl = config.cadFemDatabaseSsl ? {
    rejectUnauthorized: true,
    ...(config.cadFemDatabaseCaPath
      ? { ca: fsSync.readFileSync(config.cadFemDatabaseCaPath, 'utf8') }
      : {})
  } : false;
  if (config.cadFemDatabaseUrl) {
    return {
      connectionString: config.cadFemDatabaseUrl,
      ssl
    };
  }
  if (!config.cadFemDatabaseHost) {
    throw new Error('CAD_FEM_DATABASE_URL or CAD_FEM_DATABASE_HOST is required.');
  }
  return {
    host: config.cadFemDatabaseHost,
    port: config.cadFemDatabasePort,
    database: config.cadFemDatabaseName,
    user: config.cadFemDatabaseUser,
    password: config.cadFemDatabasePassword,
    ssl
  };
}

async function migrationFiles() {
  const root = path.resolve(__dirname, '..', 'backend', 'db');
  const migrations = path.join(root, 'migrations');
  const names = (await fs.readdir(migrations))
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort();
  return [
    { name: '001_base_schema.sql', path: path.join(root, 'schema.sql') },
    ...names.map((name) => ({ name, path: path.join(migrations, name) }))
  ];
}

async function run() {
  const client = new Client(databaseOptions());
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const migration of await migrationFiles()) {
      const sql = await fs.readFile(migration.path, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await client.query(
        'SELECT sha256 FROM schema_migrations WHERE name = $1',
        [migration.name]
      );
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== checksum) {
          throw new Error(`Applied migration ${migration.name} has changed.`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, sha256) VALUES ($1, $2)',
          [migration.name, checksum]
        );
        await client.query('COMMIT');
        console.log(`Applied ${migration.name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
