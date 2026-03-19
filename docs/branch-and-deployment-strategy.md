# Branch and deployment strategy

This repo follows a **small-team, testable deploy** model similar in spirit to Claude Code style workflows: **every change is CI-tested**, and **Cloudflare is exercised before production** via a dedicated staging Worker.

## Branches

| Branch | Role |
|--------|------|
| `main` | **Production** source of truth. Merges here should only happen after review and, when touching infra/telemetry, after staging smoke checks. |
| `staging` | **Pre-production integration**. Deploys automatically to the **staging Worker** (see below). Use for end-to-end checks, telemetry, and connector tests against real Cloudflare without touching prod KV. |
| `feature/*`, `fix/*`, `chore/*` | Short-lived branches. Open **PRs** into `main` (or into `staging` first if you want stack integration before main). |

### Flow (recommended)

1. Branch from `main` → `feature/my-change`
2. Open PR → **CI** runs `build` + `test` (no deploy)
3. Optional: merge to `staging` (or open PR `feature/*` → `staging`) → **staging deploy** runs
4. Smoke-test staging URL (health, MCP `tools/list`, `telemetry_public` if relevant)
5. PR `staging` → `main` or PR `feature/*` → `main` → **production deploy** (if enabled in CI)

Adjust to taste: some teams skip a long-lived `staging` branch and only use `feature/*` + PR CI, then deploy prod from `main` after manual `wrangler deploy`. The **staging Worker** still exists for manual `npm run deploy:staging` from any branch.

## Cloudflare environments

Defined in `wrangler.toml`:

| Environment | Worker name | KV (`AQUIFER_CACHE`) | Use |
|-------------|-------------|----------------------|-----|
| *(default)* | `aquifer-mcp` | Production namespace id | Live users, `aquifer.klappy.dev` (or your prod route). |
| `staging` | `aquifer-mcp-staging` | **Preview** namespace id (same binding `wrangler dev` uses) | Isolated from **production** KV; shared with local `wrangler dev` preview data. |

**Note:** Staging uses the **preview** KV id so you can deploy staging **without creating a second KV namespace**. Tradeoff: local `wrangler dev` and staging Worker share that KV. If you need full isolation, create a dedicated KV namespace for staging and replace the id under `[[env.staging.kv_namespaces]]`.

## Commands

```bash
# CI parity (run before push)
npm run build && npm run test

# Deploy staging Worker (testable on Cloudflare, not production)
npm run deploy:staging

# Deploy production Worker (top-level wrangler environment; explicit --env="" avoids ambiguity)
npm run deploy
# or explicitly:
npm run deploy:production
```

After `deploy:staging`, find the URL in the Wrangler output (e.g. `https://aquifer-mcp-staging.<account>.workers.dev`) or attach a **staging** route in the Cloudflare dashboard.

## GitHub Actions

Workflows live under `.github/workflows/`:

- **`ci.yml`** — on every push and PR: install, `build`, `test`. **No secrets required.**
- **`deploy-staging.yml`** — on push to `staging`: `wrangler deploy --env staging`. Requires repo secrets.
- **`deploy-production.yml`** — on push to `main`: `wrangler deploy` (default env). Requires repo secrets. **Disable or gate** this job if you prefer manual production deploys only.

### Required secrets (for deploy workflows)

Add in GitHub → Settings → Secrets and variables → Actions:

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | API token with Workers + KV deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id |

Optional: use GitHub **environments** (`production`) with required reviewers to gate `deploy-production.yml`.

## Custom domains

Production often uses a Worker route (e.g. `aquifer.klappy.dev`). Staging can stay on `*.workers.dev` or a dedicated hostname (e.g. `staging-aquifer.klappy.dev`) configured in the dashboard—no code change required beyond DNS/routes.

## Related docs

- `docs/telemetry-governance-snapshot.md` — telemetry behavior and KV storage notes
- `README.md` — local dev, health checks, MCP URLs
