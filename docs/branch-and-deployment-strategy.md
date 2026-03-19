# Branch and deployment strategy

**Deploy:** one Worker (**`aquifer-mcp`**) via **Cloudflare Git integration** on whatever branch you connect (usually **`main`**). Pushing the git branch **`staging` does not mean “deploy staging”** — it is only a collaboration/integration branch unless you deliberately configure something else in Cloudflare (this repo’s docs assume you do not).

**CI:** GitHub Actions runs **build + test** on pushes and PRs; it does **not** deploy.

## Branches

| Branch | Role |
|--------|------|
| `main` | **Production** source of truth. When Cloudflare is tied to `main`, merges here are what go live. |
| `staging` | **Git integration branch** (optional): stack work, run CI, open PRs toward `main`. **Not** a separate Cloudflare staging deploy in the default setup. |
| `feature/*`, `fix/*`, `chore/*` | Short-lived branches. Open **PRs** into `main` (or into `staging` first if your team stacks there). |

### Flow (recommended)

1. Branch from `main` → `feature/my-change`
2. Open PR → **CI** runs `build` + `test` (no deploy)
3. Optional: merge to `staging` for integration — **still no separate “staging deploy”** unless you have explicitly built that in Cloudflare yourself
4. PR → `main` → Cloudflare deploys when your connected branch updates

## Wrangler environments (`wrangler.toml`)

| Environment | Worker name | KV (`AQUIFER_CACHE`) | Use |
|-------------|-------------|----------------------|-----|
| *(default)* | `aquifer-mcp` | Production namespace id | **What Cloudflare Git deploys** in the normal setup. Live route (e.g. `aquifer.klappy.dev`). |
| `staging` | `aquifer-mcp-staging` | **Preview** namespace id | **Optional:** local `wrangler dev --env staging` or rare maintainer `wrangler deploy --env staging`. **Not** implied by pushing the `staging` git branch. |

The preview KV id keeps local/preview data out of production KV when you use the staging **Wrangler** environment locally.

## Commands

```bash
# CI parity (run before push)
npm run build && npm run test

# Live deploy: push to the branch Cloudflare watches (see DEPLOY-SETUP.md)

# Maintainer CLI (not Cloudflare Git):
npm run deploy              # default Worker
npm run deploy:staging      # optional Wrangler env only — not “git branch staging”
```

Find the live Worker URL in **Cloudflare → Workers** after a successful build.

## GitHub Actions

Only **`.github/workflows/ci.yml`**: install, `build`, `test`. **No deploy, no Cloudflare secrets required.**

## Custom domains

Production often uses a Worker route (e.g. `aquifer.klappy.dev`). Configure in the dashboard.

## Related docs

- [`DEPLOY-SETUP.md`](../DEPLOY-SETUP.md) — Cloudflare Git connection checklist
- `docs/telemetry-governance-snapshot.md` — telemetry behavior and KV storage notes
- `README.md` — local dev, health checks, MCP URLs
