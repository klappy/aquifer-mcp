# Branch and deployment strategy

This repo follows a **small-team, testable deploy** model: **every change can be CI-tested in GitHub**, and **Cloudflare runs the actual deploy** when you push to whatever branch is connected in the **Cloudflare dashboard** (Git integration / Workers build from repo).

## Branches

| Branch | Role |
|--------|------|
| `main` | **Production** source of truth for code. Merges here should follow your review process. **Whether `main` auto-deploys** depends on Cloudflare: connect `main` to the production Worker project. |
| `staging` | **Pre-production integration** (optional). Use when you have a **staging Worker** (`aquifer-mcp-staging` in `wrangler.toml`) wired to this branch in Cloudflare. |
| `feature/*`, `fix/*`, `chore/*` | Short-lived branches. Open **PRs** into `main` (or into `staging` first if you stack integration there). |

### Flow (recommended)

1. Branch from `main` → `feature/my-change`
2. Open PR → **CI** runs `build` + `test` (no deploy)
3. Optional: merge to `staging` → Cloudflare deploys **if** that branch is connected to the staging Worker in the dashboard
4. Smoke-test staging URL (`/health`, MCP `tools/list`, etc.)
5. PR → `main` → Cloudflare deploys **if** `main` is connected to production

## Cloudflare environments

Defined in `wrangler.toml`:

| Environment | Worker name | KV (`AQUIFER_CACHE`) | Use |
|-------------|-------------|----------------------|-----|
| *(default)* | `aquifer-mcp` | Production namespace id | Live users, custom route (e.g. `aquifer.klappy.dev`). |
| `staging` | `aquifer-mcp-staging` | **Preview** namespace id | Isolated from **production** KV; shared with local `wrangler dev` preview data unless you swap the namespace id. |

**Note:** Staging uses the **preview** KV id so you can avoid a second paid namespace. Tradeoff: local `wrangler dev` and the staging Worker can share that KV. For full isolation, create a dedicated KV namespace and set it under `[[env.staging.kv_namespaces]]`.

## Commands

```bash
# CI parity (run before push)
npm run build && npm run test

# Deploy: push to the branch your Cloudflare project is connected to (see DEPLOY-SETUP.md)

# Emergency / maintainer CLI only:
npm run deploy:staging
npm run deploy
# or: npm run deploy:production
```

Find Worker URLs in **Cloudflare → Workers** after a successful build, or in the Git integration build log.

## GitHub Actions

Only **`.github/workflows/ci.yml`** remains: on push and PR, install, `build`, `test`. **No deploy, no Cloudflare secrets required.**

If you later add a custom deploy workflow, you would supply `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` yourself — that is **not** part of the default repo setup.

## Custom domains

Production often uses a Worker route (e.g. `aquifer.klappy.dev`). Staging can stay on `*.workers.dev` or a dedicated hostname in the dashboard.

## Related docs

- [`DEPLOY-SETUP.md`](../DEPLOY-SETUP.md) — Cloudflare Git connection checklist
- `docs/telemetry-governance-snapshot.md` — telemetry behavior and KV storage notes
- `README.md` — local dev, health checks, MCP URLs
