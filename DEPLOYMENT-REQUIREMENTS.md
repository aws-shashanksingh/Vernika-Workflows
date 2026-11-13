# Vernika Workflows deployment requirements

## Required Vercel environment variables

Set these in the Vercel project's **Settings → Environment Variables** for Production (and Preview/Development if you will use those environments). The application expects these exact names:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | Project URL from Supabase **Project Settings → API** |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side service-role key for that Supabase project. Keep it private; never use a `VITE_` name. The server also accepts Supabase's newer `SUPABASE_SECRET_KEY` variable if that is what the Vercel integration provides. |
| `ADMIN_USERNAME` | Username you choose for the Vernika administrator, for example `vernika-admin` |
| `ADMIN_PASSWORD` | A unique, strong password you choose |
| `ADMIN_OTP` | Your administrator's numeric OTP, 6–10 digits |
| `SESSION_SECRET` | Random signing secret, at least 32 characters |
| `CREDENTIAL_ENCRYPTION_KEY` | Base64-encoded random 32-byte key used to encrypt saved integration credentials |

These are the minimum setup variables for the shared admin/customer login and credential management. No Supabase anon key or `VITE_SUPABASE_ANON_KEY` is required by this application. If Vercel's Supabase integration created variables with different names, add the names above in Vercel and use the matching values from that same project.

Generate unique values locally in Terminal; do not paste secret values into source files or commit them:

```sh
python3 -c 'import secrets; print(secrets.token_urlsafe(32))' # use for ADMIN_PASSWORD
python3 -c 'import secrets; print(f"{secrets.randbelow(10**8):08d}")' # use for ADMIN_OTP
openssl rand -base64 32 # use one output for SESSION_SECRET
openssl rand -base64 32 # run again; use the other output for CREDENTIAL_ENCRYPTION_KEY
```

Keep the encryption key backed up securely. Changing `SESSION_SECRET` invalidates sessions; changing `CREDENTIAL_ENCRYPTION_KEY` prevents decryption of credentials already saved by the admin.

After setting these values and deploying, sign in at `https://<your-vercel-domain>/admin` using `ADMIN_USERNAME` and `ADMIN_PASSWORD`, then enter `ADMIN_OTP`. The same admin credentials are accepted by the shared login used across the three tool dashboards and grant administrator access to all supported tools. Customer accounts are created separately inside the admin console.

If sign-in reports a Supabase/auth setup error, open `https://<your-vercel-domain>/api/access/health` (no login required). It reports only configuration booleans, not secret values. For `loginSchema: false`, verify the URL and server key belong to the same Supabase project and run `supabase/vernika_complete_schema.sql` there. After changing Vercel variables, redeploy so the deployment receives them.

## Automated Blogger

Set these only if you will use server-configured Blogger publishing or scheduled publishing. Individual integrations can also be added under the admin console instead.

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `BLOGGER_BLOG_ID` (optional if using the existing default blog ID)
- `PUBLISH_SECRET` (optional; protects external publishing triggers)
- `CRON_SECRET` (optional; set if you want to protect the Vercel Cron endpoint)

Optional server-side AI and image providers:

- `DEEPSEEK_API_KEY`
- `GEMINI_API_KEY`
- `POLLINATIONS_API_KEY`

The existing n8n workflow does not need to be recreated or configured through new environment variables. Its integration can continue to use the existing defaults or the admin-managed `n8n-config`.

If you need to override the existing n8n defaults globally, the optional server variables are `N8N_WEBHOOK_URL`, `N8N_MCP_URL`, and `N8N_API_KEY`. Otherwise, leave them unset.

Firebase Web configuration can be added as `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID` only if Firebase sign-in is enabled. These are browser configuration values, not server secrets. Firebase sign-in is not required for the Vernika account login.

## Blogger SEO Indexer

- Google Cloud service-account JSON can be supplied by an admin using the credential name `GOOGLE_SERVICE_ACCOUNT_JSON`, or entered by the customer in the tool.
- `DAILY_QUOTA_PER_ACCOUNT` is optional and defaults to the tool's existing quota.
- The indexer's Supabase data uses the shared `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## SEO PDF Studio

- Service-account JSON can be supplied by an admin using `GOOGLE_SERVICE_ACCOUNT_JSON`, or entered by the customer in the tool.
- Admin-managed `GITHUB_TOKEN` and `INDEXNOW_KEY` credentials are consumed server-side for the corresponding PDF Studio operations.
- Optional server variables are `GITHUB_REPO`, `GITHUB_BRANCH` (defaults to `main`), `GITHUB_TOKEN`, and `INDEXNOW_KEY`; admin-managed credentials may be used instead.
- The studio uses the shared project URL and private server key for server-side database operations.

## Admin-managed customer credentials

The admin console encrypts saved credentials using `CREDENTIAL_ENCRYPTION_KEY`. Use these exact names:

- Blogger: `GOOGLE_REFRESH_TOKEN`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `POLLINATIONS_API_KEY`, or `n8n-config` (JSON containing the existing workflow URLs/key).
- Indexer: `GOOGLE_SERVICE_ACCOUNT_JSON` (valid Google service-account JSON; the tool provisions it into the customer's account pool).
- PDF Studio: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GITHUB_TOKEN`, or `INDEXNOW_KEY`.

Customer-entered Google refresh tokens and AI keys are also saved encrypted to that account when saved in the tool. Secret values are not returned by the admin credential-list API. Do not put private values in variables prefixed with `VITE_`; those are intended for client-visible build configuration.

## Supabase setup

1. Create a new Supabase project.
2. Run `supabase/vernika_complete_schema.sql` once in the SQL editor. It creates the shared platform/admin tables and existing Blogger/n8n workflow tables, including the restricted `vernika_storage_usage()` function used by the admin usage panel. Do not run the two component SQL files as well.
3. Configure Vercel environment variables and deploy from the `Vernika-Workflows` directory.
4. Test the admin login, create a customer, assign one or more tools, and set a future expiry before customer use.

Customer password and OTP values are salted and hashed before storage. Admin-managed integration credentials are encrypted with AES-256-GCM; their plaintext values are not returned by the admin API. Keep the encryption key backed up outside the repository.

## Local development

Use Node.js 22 or newer and npm. Copy `.env.example` to `.env`, configure a new development Supabase project, install dependencies with `npm install`, and run `npm run dev`. Do not reuse production credentials for local development.

Vercel's serverless execution, free-tier quotas, database connection limits, and third-party API quotas are not suitable for promising 100,000 simultaneous active sessions without load testing and a separately planned scaling architecture.
