# Branch and deployment strategy

**Deploy:** **Cloudflare Git integration** builds this Worker on push.

- **Production** — default worker **`aquifer-mcp`**, typically from branch **`main`**, often behind a custom domain (e.g. `aquifer.klappy.dev`).
- **Pre-production / branch testing** — previews use **`https://<branch-slug>-aquifer-mcp.klappy.workers.dev`**. For git branch **`staging`**: **`https://staging-aquifer-mcp.klappy.workers.dev`**.

**CI:** GitHub Actions runs **build + test** on pushes and PRs; it does **not** deploy.

## Branches

| Branch | Role |
|--------|------|
| `main` | **Production** source of truth. When Cloudflare uses `main` as the production branch, merges here update the live custom domain / production worker. |
| `staging` | **Pre-production integration**: **`https://staging-aquifer-mcp.klappy.workers.dev`** — `GET /health`, `POST /mcp`. |
| `feature/*`, `fix/*`, `chore/*` | Short-lived branches. Open **PRs** into `main` or `staging`; preview hostname is **`<slug>-aquifer-mcp.klappy.workers.dev`** (slug usually matches the branch). |

### Flow (recommended)

1. Branch from `main` → `feature/my-change`
2. Open PR → **CI** runs `build` + `test` (no deploy in GitHub)
3. Optional: merge to `staging` → Cloudflare **preview** deploy → **`https://staging-aquifer-mcp.klappy.workers.dev`**
4. PR → `main` → Cloudflare **production** deploy

## Wrangler environments (`wrangler.toml`)

| Environment | Worker name | KV (`AQUIFER_CACHE`) | Use |
|-------------|-------------|----------------------|-----|
| *(default)* | `aquifer-mcp` | Production namespace id | **Production** Cloudflare Git build; custom route (e.g. `aquifer.klappy.dev`). |
| `staging` | `aquifer-mcp-staging` | **Preview** namespace id | **Local / maintainer only:** `wrangler dev --env staging` or `npm run deploy:staging`. **Not** the Git preview host **`staging-aquifer-mcp.klappy.workers.dev`**. |

The preview KV id keeps local/preview KV separate from production when using the **Wrangler** `staging` env locally.

## Commands

```bash
# CI parity (run before push)
npm run build && npm run test

# Live: push your branch — then use the preview or production URL from Cloudflare (see DEPLOY-SETUP.md)

# Maintainer CLI (not Cloudflare Git previews):
npm run deploy              # default Worker
npm run deploy:staging      # optional Wrangler env for local experiments
```

## GitHub Actions

Only **`.github/workflows/ci.yml`**: install, `build`, `test`. **No deploy, no Cloudflare secrets required.**

## Custom domains

Production often uses a Worker route (e.g. `aquifer.klappy.dev`). Staging preview: **`staging-aquifer-mcp.klappy.workers.dev`**. Other branches: **`<slug>-aquifer-mcp.klappy.workers.dev`**.

## Related docs

- [`DEPLOY-SETUP.md`](../DEPLOY-SETUP.md) — Cloudflare Git + preview URL pattern
- `docs/telemetry-governance-snapshot.md` — telemetry behavior and KV storage notes
- `README.md` — local dev, health checks, MCP URLs
