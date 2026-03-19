# Deploy setup — Cloudflare Git integration

**Deploys are not driven by GitHub Actions in this repo.** Production (and any other Workers you wire up) deploy when **Cloudflare builds from your connected Git repository** — the same flow you configure in the **Cloudflare dashboard** (Git connection / Workers Builds). A push to the branch Cloudflare watches triggers a deploy.

This doc is the checklist so expectations match `wrangler.toml` and branches.

---

## One-time: connect the repo in Cloudflare

1. Log in: **https://dash.cloudflare.com**
2. Open **Workers & Pages** → your Worker project for Aquifer MCP (or create one from this repo).
3. Use Cloudflare’s **Git integration** to connect **this GitHub repo** and pick:
   - **Production branch** (often `main`) — maps to the **default** Wrangler environment → Worker name **`aquifer-mcp`** in `wrangler.toml`.
   - If you use a **staging** Worker: either a **second Cloudflare project** bound to branch **`staging`** with build settings that run `wrangler deploy --env staging`, or Cloudflare’s **branch preview / environment** options if your plan supports them — match whatever the dashboard shows to **`[env.staging]`** (`aquifer-mcp-staging`).

Exact UI labels change over time; the invariant is: **the dashboard decides which branch deploys which Worker**, not this README.

4. Confirm **build command** and **root directory** in the Cloudflare project match how this repo builds (typically `npm ci` + `npm run build` / deploy step Wrangler expects — align with Cloudflare’s Worker build docs for Node projects).

---

## After setup — normal life

| You want | You do |
|----------|--------|
| **Deploy** | Push (or merge) to the branch Cloudflare has connected for that Worker. |
| **Verify** | Cloudflare build logs, then `GET /health` on the Worker URL. |

You do **not** need GitHub repository secrets for deploy **unless** you add your own optional workflows (this repo only runs **CI**: build + test).

---

## Local / emergency CLI

Maintainers can still run Wrangler from a machine with credentials:

```bash
npm run deploy:staging   # staging env
npm run deploy           # production (default env)
```

Use when debugging builds or when the dashboard path is unavailable — not required for day-to-day deploys if Git integration is on.

---

## CI in GitHub (tests only)

Workflow **`.github/workflows/ci.yml`** runs on pushes and PRs: install, `build`, `test`. It does **not** deploy.

---

## More detail

- Branch roles and Worker names: [`docs/branch-and-deployment-strategy.md`](docs/branch-and-deployment-strategy.md)
