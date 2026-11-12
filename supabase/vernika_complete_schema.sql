-- Vernika Workflows complete Supabase schema.
-- Run this single file in Supabase SQL Editor for a new project.
-- Includes the shared platform/admin tables and Automated Blogger/n8n tables.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.workflow_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_name text NOT NULL,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  otp_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'disabled')),
  assigned_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_users_assigned_tools_array CHECK (jsonb_typeof(assigned_tools) = 'array')
);

CREATE TABLE IF NOT EXISTS public.workflow_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.workflow_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  device_info text,
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS workflow_sessions_user_active_idx
  ON public.workflow_sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS workflow_sessions_one_active_device_idx
  ON public.workflow_sessions (user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.workflow_login_attempts (
  id text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_login_attempts_expiry_idx
  ON public.workflow_login_attempts (expires_at);

CREATE TABLE IF NOT EXISTS public.workflow_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.workflow_users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  ip_address inet,
  device_info text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workflow_activity_logs_user_time_idx
  ON public.workflow_activity_logs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.workflow_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.workflow_users(id) ON DELETE CASCADE,
  tool text NOT NULL CHECK (tool IN ('blogger', 'indexer', 'seo-pdf')),
  name text NOT NULL,
  encrypted_value text NOT NULL,
  iv text NOT NULL,
  auth_tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tool, name)
);

CREATE INDEX IF NOT EXISTS workflow_secrets_user_tool_idx
  ON public.workflow_secrets (user_id, tool);

CREATE TABLE IF NOT EXISTS public.service_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  admin_managed boolean NOT NULL DEFAULT false,
  project_name text NOT NULL,
  client_email text NOT NULL,
  credentials jsonb NOT NULL,
  daily_count integer NOT NULL DEFAULT 0,
  last_reset_date date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_accounts
  ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.service_accounts
  ADD COLUMN IF NOT EXISTS admin_managed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS service_accounts_user_active_quota_idx
  ON public.service_accounts (user_id, is_active, daily_count, last_reset_date);

CREATE INDEX IF NOT EXISTS service_accounts_user_project_idx
  ON public.service_accounts (user_id, project_name);

CREATE TABLE IF NOT EXISTS public.url_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  url text NOT NULL,
  status text NOT NULL,
  notification_type text NOT NULL DEFAULT 'URL_UPDATED',
  http_code integer,
  used_account_id uuid REFERENCES public.service_accounts(id) ON DELETE SET NULL,
  used_project_name text,
  response_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.url_logs
  ADD COLUMN IF NOT EXISTS user_id uuid;

CREATE INDEX IF NOT EXISTS url_logs_user_created_idx
  ON public.url_logs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS url_logs_user_status_idx
  ON public.url_logs (user_id, status);

CREATE TABLE IF NOT EXISTS public.requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id uuid,
  company_name text NOT NULL DEFAULT '',
  company_email text NOT NULL DEFAULT '',
  company_website text NOT NULL DEFAULT '',
  blog_type text NOT NULL DEFAULT 'airlines',
  keyword text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT '',
  tfn text NOT NULL DEFAULT '',
  tfn_number text NOT NULL DEFAULT '',
  airline_name text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT 'Headquarters',
  country text NOT NULL DEFAULT 'United States',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.request (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_name text NOT NULL DEFAULT '',
  company_email text NOT NULL DEFAULT '',
  company_website text NOT NULL DEFAULT '',
  blog_type text NOT NULL DEFAULT 'airlines',
  keyword text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT '',
  tfn text NOT NULL DEFAULT '',
  tfn_number text NOT NULL DEFAULT '',
  airline_name text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT 'Headquarters',
  country text NOT NULL DEFAULT 'United States',
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_blog_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_name text NOT NULL DEFAULT '',
  company_email text NOT NULL DEFAULT '',
  company_website text NOT NULL DEFAULT '',
  blog_type text NOT NULL DEFAULT 'airlines',
  keyword text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT '',
  tfn text NOT NULL DEFAULT '',
  tfn_number text NOT NULL DEFAULT '',
  airline_name text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT 'Headquarters',
  country text NOT NULL DEFAULT 'United States',
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."User blog request" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  company_name text NOT NULL DEFAULT '',
  company_email text NOT NULL DEFAULT '',
  company_website text NOT NULL DEFAULT '',
  blog_type text NOT NULL DEFAULT 'airlines',
  keyword text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT '',
  tfn text NOT NULL DEFAULT '',
  tfn_number text NOT NULL DEFAULT '',
  airline_name text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT 'Headquarters',
  country text NOT NULL DEFAULT 'United States',
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text,
  blog_type text NOT NULL DEFAULT 'airlines',
  title text NOT NULL DEFAULT '',
  keyword text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT '',
  content_html text NOT NULL DEFAULT '',
  html_content text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  banner_url text,
  image_url text,
  airline_name text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Draft',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blog_templates (
  id text PRIMARY KEY,
  template_name text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'airlines',
  title text NOT NULL DEFAULT '',
  keyword text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  html_content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  airline_name text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  post_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.topics (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  topic text NOT NULL,
  keyword text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published')),
  post_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS requests_status_idx
  ON public.requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_user_created_idx
  ON public.requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS blogs_request_idx
  ON public.blogs (request_id, created_at DESC);
CREATE INDEX IF NOT EXISTS blog_posts_airline_city_idx
  ON public.blog_posts (airline_name, city);
CREATE INDEX IF NOT EXISTS topics_pending_idx
  ON public.topics (status, id)
  WHERE status = 'pending';

ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS user_id uuid;

ALTER TABLE public.workflow_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.url_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blog_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User blog request" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.workflow_users FROM anon, authenticated;
REVOKE ALL ON public.workflow_sessions FROM anon, authenticated;
REVOKE ALL ON public.workflow_login_attempts FROM anon, authenticated;
REVOKE ALL ON public.workflow_activity_logs FROM anon, authenticated;
REVOKE ALL ON public.workflow_secrets FROM anon, authenticated;
REVOKE ALL ON public.service_accounts FROM anon, authenticated;
REVOKE ALL ON public.url_logs FROM anon, authenticated;
REVOKE ALL ON public.requests FROM anon, authenticated;
REVOKE ALL ON public.request FROM anon, authenticated;
REVOKE ALL ON public.user_blog_requests FROM anon, authenticated;
REVOKE ALL ON public."User blog request" FROM anon, authenticated;
REVOKE ALL ON public.blogs FROM anon, authenticated;
REVOKE ALL ON public.blog_templates FROM anon, authenticated;
REVOKE ALL ON public.blog_posts FROM anon, authenticated;
REVOKE ALL ON public.topics FROM anon, authenticated;

GRANT ALL ON public.workflow_users TO service_role;
GRANT ALL ON public.workflow_sessions TO service_role;
GRANT ALL ON public.workflow_login_attempts TO service_role;
GRANT ALL ON public.workflow_activity_logs TO service_role;
GRANT ALL ON public.workflow_secrets TO service_role;
GRANT ALL ON public.service_accounts TO service_role;
GRANT ALL ON public.url_logs TO service_role;
GRANT ALL ON public.requests TO service_role;
GRANT ALL ON public.request TO service_role;
GRANT ALL ON public.user_blog_requests TO service_role;
GRANT ALL ON public."User blog request" TO service_role;
GRANT ALL ON public.blogs TO service_role;
GRANT ALL ON public.blog_templates TO service_role;
GRANT ALL ON public.blog_posts TO service_role;
GRANT ALL ON public.topics TO service_role;

CREATE OR REPLACE FUNCTION public.reset_daily_quotas_if_needed()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.service_accounts
  SET daily_count = 0, last_reset_date = CURRENT_DATE, updated_at = now()
  WHERE last_reset_date < CURRENT_DATE;
$$;

CREATE OR REPLACE FUNCTION public.vernika_storage_usage()
RETURNS TABLE(table_name text, total_bytes bigint, table_bytes bigint, index_bytes bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    format('%I.%I', namespace.nspname, relation.relname)::text,
    pg_total_relation_size(relation.oid)::bigint,
    pg_relation_size(relation.oid)::bigint,
    pg_indexes_size(relation.oid)::bigint
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'm')
    AND relation.relname = ANY (ARRAY[
      'workflow_users', 'workflow_sessions', 'workflow_login_attempts',
      'workflow_activity_logs', 'workflow_secrets', 'service_accounts',
      'url_logs', 'requests', 'request', 'user_blog_requests',
      'User blog request', 'blogs', 'blog_templates', 'blog_posts', 'topics'
    ])
  ORDER BY pg_total_relation_size(relation.oid) DESC;
$$;

REVOKE ALL ON FUNCTION public.vernika_storage_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vernika_storage_usage() TO service_role;
