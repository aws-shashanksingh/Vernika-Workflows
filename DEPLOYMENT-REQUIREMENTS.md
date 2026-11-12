# Vernika Workflows deployment requirements

## Required Vercel environment variables

Configure these only in the Vercel project settings. Do not commit populated values.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | New Vernika Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service role key |
| `VITE_SUPABASE_URL` | Supabase project URL used by the browser |
| `VITE_SUPABASE_ANON_KEY` | Supabase public anon key; protect tables with the included RLS setup |
| `ADMIN_USERNAME` | Initial Vernika admin username |
| `ADMIN_PASSWORD` | Initial Vernika admin password |
| `ADMIN_OTP` | Initial admin second factor |
| `SESSION_SECRET` | Random signing secret of at least 32 characters |
| `CREDENTIAL_ENCRYPTION_KEY` | Base64-encoded random 32-byte AES-256-GCM key |

Generate `SESSION_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` independently. Changing either after deployment invalidates sessions or prevents decryption of previously saved credentials.

## Automated Blogger

Required when the corresponding publishing features are used:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `BLOGGER_BLOG_ID`
- `PUBLISH_SECRET`
- `CRON_SECRET`
- `APP_URL`

Optional server-side AI and image providers:

- `DEEPSEEK_API_KEY`
- `GEMINI_API_KEY`
- `POLLINATIONS_API_KEY`
- `POLLINATIONS_APP_KEY`

Firebase Web configuration can be added as `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID` if Firebase sign-in is enabled. These are browser configuration values, not server secrets. Firebase sign-in is not required for the Vernika account login.

## Blogger SEO Indexer

- Google Cloud service-account JSON can be supplied by an admin using the credential name `GOOGLE_SERVICE_ACCOUNT_JSON`, or entered by the customer in the tool.
- `DAILY_QUOTA_PER_ACCOUNT` is optional and defaults to the tool's existing quota.
- The indexer's Supabase data uses the shared `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## SEO PDF Studio

- Service-account JSON can be supplied by an admin using `GOOGLE_SERVICE_ACCOUNT_JSON`, or entered by the customer in the tool.
- Admin-managed `GITHUB_TOKEN` and `INDEXNOW_KEY` credentials are consumed server-side for the corresponding PDF Studio operations.
- The studio uses the shared project URL and private server key for server-side database operations.

## Admin-managed customer credentials

The admin console encrypts saved credentials using `CREDENTIAL_ENCRYPTION_KEY`. Use these exact names:

- Blogger: `GOOGLE_REFRESH_TOKEN`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `POLLINATIONS_API_KEY`, or `n8n-config` (JSON containing the existing workflow URLs/key).
- Indexer: `GOOGLE_SERVICE_ACCOUNT_JSON` (valid Google service-account JSON; the tool provisions it into the customer's account pool).
- PDF Studio: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GITHUB_TOKEN`, or `INDEXNOW_KEY`.

Customer-entered Google refresh tokens and AI keys are also saved encrypted to that account when saved in the tool. Secret values are not returned by the admin credential-list API. Do not put private values in variables prefixed with `VITE_`; those are intended for client-visible build configuration.

## Supabase setup

1. Create a new Supabase project.
2. Run the latest `supabase/vernika_platform.sql` in the SQL editor. It includes the restricted `vernika_storage_usage()` function used by the admin usage panel.
3. Run `supabase/schema.sql` to create the existing Blogger workflow tables.
4. Configure Vercel environment variables and deploy from the `Vernika-Workflows` directory.
5. Test the admin login, create a customer, assign one or more tools, and set a future expiry before customer use.

Customer password and OTP values are salted and hashed before storage. Admin-managed integration credentials are encrypted with AES-256-GCM; their plaintext values are not returned by the admin API. Keep the encryption key backed up outside the repository.

## Local development

Use Node.js 22 or newer and npm. Copy `.env.example` to `.env`, configure a new development Supabase project, install dependencies with `npm install`, and run `npm run dev`. Do not reuse production credentials for local development.

Vercel's serverless execution, free-tier quotas, database connection limits, and third-party API quotas are not suitable for promising 100,000 simultaneous active sessions without load testing and a separately planned scaling architecture.
