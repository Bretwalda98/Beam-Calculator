-- PostgreSQL production schema for Professional Beam Calculator.
-- UUID generation requires pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subscription_tier text NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'professional', 'enterprise')),
  subscription_status text NOT NULL DEFAULT 'inactive',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  email citext UNIQUE NOT NULL,
  display_name text,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin', 'engineer', 'viewer')),
  auth_provider text NOT NULL,
  auth_subject text NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(auth_provider, auth_subject)
);

CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'system',
  layout_mode text NOT NULL DEFAULT 'auto',
  default_engineer_name text,
  default_company_name text,
  settings_json jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE beam_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family text NOT NULL,
  name text NOT NULL,
  source_name text,
  source_reference text,
  source_edition text,
  region text,
  properties jsonb NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(family, name)
);

CREATE TABLE materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grade text UNIQUE NOT NULL,
  properties jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  name text NOT NULL,
  job_reference text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_projects_owner_updated ON projects(owner_user_id, updated_at DESC);

CREATE TABLE project_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  input_json jsonb NOT NULL,
  result_json jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, revision_number)
);

CREATE TABLE calculation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  revision_id uuid REFERENCES project_revisions(id) ON DELETE SET NULL,
  request_hash text NOT NULL,
  result_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  ip_address inet,
  user_agent text,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  tier text NOT NULL CHECK (tier IN ('free', 'professional', 'enterprise')),
  status text NOT NULL,
  seats integer NOT NULL DEFAULT 1,
  valid_until timestamptz,
  feature_flags jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
