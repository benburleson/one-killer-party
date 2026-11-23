# Development environments

## Dev container and Codespaces

The preferred interactive workspace is [`.devcontainer/devcontainer.json`](../.devcontainer/devcontainer.json): Node 22, Docker-in-Docker, `npm ci`, and Playwright Chromium dependencies. In VS Code choose **Dev Containers: Reopen in Container**, or open the repository in GitHub Codespaces. Keep forwarded database/API/Studio/email ports **Private**.

```sh
npm ci
npx supabase start
npx supabase db reset --no-seed
npx supabase test db
npm run dev
```

The application uses forwarded port 3000. Supabase local API is 54321, database 54322, Studio 54323, and captured mail UI 54324. Obtain local development credentials from `npx supabase status`, but **do not share or commit the output**. Set `APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in an uncommitted local `.env.local`, pointing only at the disposable local Supabase stack. See the exact Codespaces callback/origin constraints in [lobby persistence](architecture/lobby-persistence.md).

Stop the disposable stack with `npx supabase stop --no-backup`. **Do not execute a remote reset**, apply production migrations while running tests, or expose the privileged service-role key to client code. Host/email delivery on production is configured separately in [production operations](production-operations.md).

## Validation

```sh
npm run test:unit
npm run lint
npx tsc --noEmit
npm run build
npm run test:e2e -- --project=desktop-chromium --project=mobile-chromium
```

Run Playwright against the intended local/ephemeral environment. CI publishes
only the browser evidence allowlisted by the workflow; do not upload arbitrary
DOM, traces, test-result context, or logs that may contain sensitive data. The
GitHub Actions [CI workflow](../.github/workflows/ci.yml) runs isolated
Supabase database-security checks and separate smoke/integration coverage.
It must not receive production database credentials.

## Copilot and previews

Copilot's hosted agent is **not** the Codespace dev container. [`copilot-setup-steps.yml`](../.github/workflows/copilot-setup-steps.yml) prepares its separate runtime; CI independently verifies the resulting PR. Vercel PR previews are likewise separate deployments and must not silently inherit production database/service-role credentials. Human review remains mandatory for production-sensitive changes.

