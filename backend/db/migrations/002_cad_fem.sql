-- CAD/FEM persistence for the native service.
-- Apply after backend/db/schema.sql. Production code must use PostgreSQL;
-- the filesystem repository is limited to local development and tests.

CREATE TABLE IF NOT EXISTS user_identities (
  provider text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email citext,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user
  ON user_identities(user_id);

CREATE TABLE cad_fem_projects (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  name text NOT NULL,
  schema_version text NOT NULL,
  current_revision integer NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  current_geometry_revision integer NOT NULL DEFAULT 0 CHECK (current_geometry_revision >= 0),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, id)
);

CREATE INDEX idx_cad_fem_projects_owner_updated
  ON cad_fem_projects(owner_user_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE TABLE cad_fem_project_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES cad_fem_projects(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number >= 0),
  geometry_revision integer NOT NULL CHECK (geometry_revision >= 0),
  command_id uuid,
  project_json jsonb NOT NULL,
  project_sha256 text NOT NULL CHECK (project_sha256 ~ '^[a-f0-9]{64}$'),
  brep_artifact_id uuid,
  tessellation_artifact_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision_number),
  UNIQUE (project_id, command_id)
);

CREATE TABLE cad_fem_commands (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES cad_fem_projects(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_revision integer NOT NULL CHECK (base_revision >= 0),
  command_json jsonb NOT NULL,
  command_sha256 text NOT NULL CHECK (command_sha256 ~ '^[a-f0-9]{64}$'),
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (project_id, id)
);

CREATE INDEX idx_cad_fem_commands_project_created
  ON cad_fem_commands(project_id, created_at);

CREATE TABLE cad_fem_studies (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES cad_fem_projects(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  geometry_revision integer NOT NULL CHECK (geometry_revision >= 0),
  study_json jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cad_fem_jobs (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES cad_fem_projects(id) ON DELETE CASCADE,
  study_id uuid REFERENCES cad_fem_studies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('stepImport', 'stepExport', 'regenerate', 'mesh', 'solve', 'postprocess')),
  stage text NOT NULL CHECK (stage IN ('queued', 'preparing', 'regenerating', 'meshing', 'assembling', 'solving', 'recovering', 'uploading', 'complete', 'failed', 'cancelled')),
  progress double precision NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  idempotency_key text NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  input_manifest jsonb NOT NULL,
  result_manifest jsonb,
  diagnostics jsonb NOT NULL DEFAULT '[]',
  solver_versions jsonb NOT NULL DEFAULT '{}',
  cancellation_requested boolean NOT NULL DEFAULT false,
  aws_job_id text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (owner_user_id, idempotency_key)
);

CREATE INDEX idx_cad_fem_jobs_owner_requested
  ON cad_fem_jobs(owner_user_id, requested_at DESC);
CREATE INDEX idx_cad_fem_jobs_runnable
  ON cad_fem_jobs(stage, requested_at)
  WHERE stage IN ('queued', 'preparing');

CREATE TABLE cad_fem_artifacts (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES cad_fem_projects(id) ON DELETE CASCADE,
  job_id uuid REFERENCES cad_fem_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('step', 'brep', 'ocaf', 'topology', 'tessellation', 'mesh', 'vtu', 'csv', 'log', 'resultField')),
  bucket text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  immutable boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, object_key)
);

CREATE INDEX idx_cad_fem_artifacts_job ON cad_fem_artifacts(job_id);

CREATE TABLE cad_fem_quota_usage (
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  submitted_jobs integer NOT NULL DEFAULT 0 CHECK (submitted_jobs >= 0),
  cpu_seconds bigint NOT NULL DEFAULT 0 CHECK (cpu_seconds >= 0),
  stored_bytes bigint NOT NULL DEFAULT 0 CHECK (stored_bytes >= 0),
  PRIMARY KEY (owner_user_id, period_start)
);
