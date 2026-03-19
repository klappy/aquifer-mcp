# Deploy setup — Cloudflare Git integration

**Deploys are not driven by GitHub Actions in this repo.** The Worker deploys when **Cloudflare builds from your connected Git repository** (dashboard Git integration / Workers Builds).

**Production** is usually the **default** Wrangler worker **`aquifer-mcp`** on your **production branch** (often `main`), plus your custom route if configured (e.g. `aquifer.klappy.dev`).

**Preview deployments** (other branches / PRs): Cloudflare assigns URLs that match:

```text
*-aquifer-mcp.klappy.workers.dev
```

The `*` prefix is **per deployment** (branch slug, hash, etc.) — copy the **full hostname** from the **Cloudflare build / deployment details** after each push; do not guess it.

---

## One-time: connect the repo in Cloudflare

1. Log in: **https://dash.cloudflare.com**
2. Open **Workers & Pages** → your Worker project for Aquifer MCP (or create one from this repo).
3. Connect **this GitHub repo** and set the **production branch** (often `main`). The build should target the default Wrangler project (worker name **`aquifer-mcp`**).

Exact UI labels change over time; the invariant is: **the dashboard shows the real preview and production URLs**, not this README.

4. Confirm **build command** and **root directory** in the Cloudflare project match how this repo builds (typically `npm ci` + `npm run build` / whatever Wrangler expects — align with Cloudflare’s Worker build docs for Node projects).

---

## After setup — normal life

| You want | You do |
|----------|--------|
| **Production deploy** | Push (or merge) to the **production** branch Cloudflare uses. |
| **Preview deploy (e.g. `staging`)** | Push that branch; open the deployment in Cloudflare and use the **`…-aquifer-mcp.klappy.workers.dev`** URL shown there. |
| **Verify** | `GET https://<full-hostname>/health` (preview or prod). |

You do **not** need GitHub repository secrets for deploy **unless** you add your own optional workflows (this repo only runs **CI**: build + test).

---

## Local / emergency CLI

Maintainers can run Wrangler from a machine with credentials:

```bash
npm run deploy           # production Worker (default env)
```

Optional: `npm run deploy:staging` targets `[env.staging]` in `wrangler.toml` for **local Wrangler** experiments — separate from **Cloudflare Git preview** URLs above.

---

## CI in GitHub (tests only)

Workflow **`.github/workflows/ci.yml`** runs on pushes and PRs: install, `build`, `test`. It does **not** deploy.

---

## More detail

- Branch roles: [`docs/branch-and-deployment-strategy.md`](docs/branch-and-deployment-strategy.md)
