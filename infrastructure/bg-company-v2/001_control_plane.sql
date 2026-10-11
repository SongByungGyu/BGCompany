-- Additive, isolated control plane. Never changes public/Prisma tables.
BEGIN;
CREATE SCHEMA IF NOT EXISTS bg_company_v2;
CREATE TABLE IF NOT EXISTS bg_company_v2.schema_version (
  version integer PRIMARY KEY,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS bg_company_v2.project (
  id uuid PRIMARY KEY,
  request_key text NOT NULL UNIQUE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Paused work still occupies the single business slot.
CREATE UNIQUE INDEX IF NOT EXISTS one_unfinished_business
  ON bg_company_v2.project ((true)) WHERE status IN ('active','paused');
CREATE TABLE IF NOT EXISTS bg_company_v2.task (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES bg_company_v2.project(id),
  dedup_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('research','plan','build','qa','trial_deploy','growth',
    'public_release','payments','permissions','paid_api')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued','running','succeeded','failed','interrupted','blocked_usage','awaiting_approval')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
  not_before timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id,dedup_key),
  CHECK ((status = 'running') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK (kind NOT IN ('public_release','payments','permissions','paid_api')
    OR status = 'awaiting_approval')
);
CREATE UNIQUE INDEX IF NOT EXISTS one_running_task
  ON bg_company_v2.task ((true)) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS claim_due ON bg_company_v2.task(status,not_before,created_at);
CREATE TABLE IF NOT EXISTS bg_company_v2.task_dependency (
  task_id uuid NOT NULL REFERENCES bg_company_v2.task(id),
  depends_on uuid NOT NULL REFERENCES bg_company_v2.task(id),
  PRIMARY KEY (task_id,depends_on),
  CHECK (task_id <> depends_on)
);
CREATE TABLE IF NOT EXISTS bg_company_v2.attempt (
  token uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES bg_company_v2.task(id),
  worker_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed','interrupted','blocked_usage')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  stopped_at timestamptz,
  error_code text,
  artifacts jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_tokens bigint CHECK (input_tokens >= 0),
  output_tokens bigint CHECK (output_tokens >= 0),
  actual_cost_micros bigint CHECK (actual_cost_micros >= 0),
  currency text CHECK (currency IN ('USD','KRW')),
  CHECK ((actual_cost_micros IS NULL) = (currency IS NULL))
);
CREATE TABLE IF NOT EXISTS bg_company_v2.usage_gate (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  state text NOT NULL CHECK (state IN ('unknown','available','exhausted')),
  source text NOT NULL CHECK (source IN ('unverified','verified_check','quota_error')),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  valid_until timestamptz,
  remaining_percent numeric CHECK (remaining_percent BETWEEN 0 AND 100)
);
INSERT INTO bg_company_v2.usage_gate(id,state,source)
  VALUES (true,'unknown','unverified') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS bg_company_v2.event (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES bg_company_v2.project(id),
  task_id uuid REFERENCES bg_company_v2.task(id),
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO bg_company_v2.schema_version(version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
