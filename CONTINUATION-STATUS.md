# Vernika Workflows task checklist

Updated: 2026-11-13

## Status

**The requested consolidated application code and multi-page build are present.** Remaining completion work is external setup and runtime validation: apply the SQL, configure Vercel/Supabase variables, and run a deployed smoke test.

## Repository

- Public repository: https://github.com/aws-shashanksingh/Vernika-Workflows
- Default branch: `main`
- The repository root is this `Vernika-Workflows` directory; dependencies, build output, and runtime `data/` directories are excluded.

## User-request checklist

### Consolidate the applications

- [x] Keep Automated Blogger as the main app at the Vernika Workflows root.
- [x] Include Blogger SEO Indexer under `tools/blogger-seo-indexer/`.
- [x] Include SEO PDF Studio under `tools/seo-automation-pdf/`.
- [x] Add separate app entry pages and Vercel routes for `/indexer`, `/seo-pdf`, and `/admin`.
- [x] Compare the three local source folders with their consolidated copies before removing the redundant folders. Every source code file had a target counterpart; `firebase-applet-config.json` was intentionally excluded, and generated PDF `dev-dist` service-worker output was omitted.
- [ ] Verify the integrated Blogger files against the exact latest public-repo revision. The removed source folder had no Git metadata, so its upstream commit cannot be established. Several files intentionally differ because shared authentication and multi-page integration have been added.
- [x] Keep the existing n8n workflow; no new n8n workflow should be created or configured.

### Shared login, profiles, and multi-user access

- [x] Use a common login/OTP API from the Blogger, Indexer, and PDF login screens.
- [x] Give each customer a profile, username/password/OTP, tool assignment, expiry, and active/disabled/expired status.
- [x] Enforce tool assignment and expiry when signing in and validating sessions.
- [x] Allow one active customer session per account and revoke previous sessions on new login.
- [x] Scope browser local/session storage by authenticated workspace.
- [x] Scope Indexer service accounts and URL logs to the authenticated user; encrypt stored service-account credentials.
- [x] Store PDF workspace config using per-user encrypted credentials.
- [x] Show the Vernika customer profile in Blogger and Indexer headers and the PDF Studio account identity area; retain PDF's existing editable workspace profile.
- [x] Show a non-blocking notice in all three tool interfaces when account access expires within two days.
- [x] Scope Indexer service-account data per user and support admin-provided `GOOGLE_SERVICE_ACCOUNT_JSON`.
- [x] Keep PDF config and service-account data encrypted per user; support admin-provided Google credentials, GitHub token, and IndexNow key.
- [x] Consume supported admin-managed Blogger credentials in refresh-token, AI-generation, image-generation, and existing workflow-config paths.
- [x] Stop returning PDF service-account private keys in workspace-config API responses; remove legacy plaintext browser copies when loading/saving credentials.
- [ ] Run cross-account isolation and uploaded-file/config tests against the configured Supabase project.

### Admin interface

- [x] Add admin login using Vercel environment variables (no default admin password committed).
- [x] Add account create/edit/disable/activate, password/OTP update, tool assignment, and expiry management.
- [x] Add encrypted credential create/list-metadata/delete operations.
- [x] Add login history/device/IP records and activity logs.
- [x] Add the requested two-day expiry reminder in all three customer interfaces.
- [x] Add a one-click 30-day account renewal action and show expired accounts distinctly from disabled accounts.
- [x] Add per-table row/storage reporting and cleanup limited to expired/revoked sessions and expired login-attempt records; customer data, activity history, and credentials are not deleted.
- [x] Add admin visibility into session duration based on session creation and last activity timestamps.

### Database, configuration, and deployment

- [x] Provide `supabase/vernika_complete_schema.sql` as the single SQL setup script.
- [x] Provide `.env.example` and `DEPLOYMENT-REQUIREMENTS.md`; new credentials are to be configured manually by the user in Vercel.
- [x] Keep Supabase service-role access server-side and remove direct browser use of customer service-role keys.
- [x] Restrict Blogger workflow tables to service-role access in the supplied schema.
- [x] Add a restricted `vernika_storage_usage()` SQL function for admin-only table-size reporting.
- [ ] Apply/test the SQL against the user's new Supabase project (intentionally not done; user will apply it).
- [ ] Confirm Vercel function behavior and login/data isolation against the user's configured project.
- [ ] Check the SQL against the user's existing n8n workflow expectations before applying it; do not change the existing workflow.
- [ ] Run a deployment smoke test after the user configures Vercel/Supabase variables.
- [ ] Do not promise 100,000 simultaneous users on free tiers; that requires separate capacity planning and load testing.

## Verification completed

- [x] `npm run lint` passed on 2026-11-11.
- [x] `npm run build` passed on 2026-11-11 and emitted the main app, Indexer, PDF Studio, and admin pages.
- [x] `npm run lint` passed on 2026-11-12 after profile/expiry/admin updates.
- [x] `npm run build` passed on 2026-11-12 after profile/expiry/admin updates.
- [x] `npm run lint` passed on 2026-11-13 after credential wiring and usage/cleanup updates.
- [x] `npm run build` passed on 2026-11-13 after credential wiring and usage/cleanup updates.
- [x] `npm run lint` and `npm run build` passed after consolidating and before deleting the three redundant source folders.
- [ ] Runtime/API tests against Supabase have not been run because no project credentials were supplied.
- [ ] Vercel platform build/deployment was not verified. The local Vercel CLI fails to start because its global installation is missing `@vercel/build-utils`; the Vite production build succeeds.
- Note: Vite reports the PDF bundle exceeds its 500 KB warning threshold (about 8.3 MB minified); build still succeeds.

## Guardrails for continuation

- Leave the existing Automated Blogger content/business logic and n8n workflow alone unless the user specifically asks for changes.
- The repository has been pushed; do not deploy until the owner configures the new Vercel/Supabase project.
- Do not request or add credentials to source. The user will configure fresh Vercel and Supabase credentials.
- Apply `supabase/vernika_complete_schema.sql` once; it creates both the platform and Blogger workflow tables and includes `vernika_storage_usage()`.
- The three sibling source folders were removed after their contents were compared with the consolidated tool directories.
