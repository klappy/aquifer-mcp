# Deploy setup — Cloudflare Git integration

**Deploys are not driven by GitHub Actions in this repo.** The Worker deploys when **Cloudflare builds from your connected Git repository** (dashboard Git integration / Workers Builds). A push to the branch Cloudflare watches triggers a deploy.

**There is one deployed Worker in the normal setup:** **`aquifer-mcp`** (default environment in `wrangler.toml`). The git branch named `staging` is for **integration and CI**, not a second Cloudflare deployment you “turn on” by pushing.

---

## One-time: connect the repo in Cloudflare

1. Log in: **https://dash.cloudflare.com**
2. Open **Workers & Pages** → your Worker project for Aquifer MCP (or create one from this repo).
3. Connect **this GitHub repo** and set the **production branch** (often `main`) to match how you release. The build should use the **default** Wrangler project (worker name **`aquifer-mcp`**).

Exact UI labels change over time; the invariant is: **the dashboard decides which branch deploys**, not this README.

4. Confirm **build command** and **root directory** in the Cloudflare project match how this repo builds (typically `npm ci` + `npm run build` / whatever Wrangler expects — align with Cloudflare’s Worker build docs for Node projects).

---

## After setup — normal life

| You want | You do |
|----------|--------|
| **Deploy** | Push (or merge) to the branch Cloudflare has connected for that Worker. |
| **Verify** | Cloudflare build logs, then `GET /health` on the Worker URL. |

You do **not** need GitHub repository secrets for deploy **unless** you add your own optional workflows (this repo only runs **CI**: build + test).

---

## Local / emergency CLI

Maintainers can run Wrangler from a machine with credentials:

```bash
npm run deploy           # production Worker (default env)
```

Optional: `npm run deploy:staging` targets `[env.staging]` in `wrangler.toml` for **local experiments** — it is **not** the same as “push the `staging` git branch to Cloudflare.”

---

## CI in GitHub (tests only)

Workflow **`.github/workflows/ci.yml`** runs on pushes and PRs: install, `build`, `test`. It does **not** deploy.

---

## More detail

- Branch roles: [`docs/branch-and-deployment-strategy.md`](docs/branch-and-deployment-strategy.md)
