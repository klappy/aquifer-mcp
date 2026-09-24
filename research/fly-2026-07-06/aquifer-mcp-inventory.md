# Aquifer MCP — Stewardship Fly Inventory

**Session:** local_8e124453-f3d9-4276-bcb6-dceedf4b605d (Fable, 2026-07-07)
**Repo:** https://github.com/klappy/aquifer-mcp — **owner verified: klappy personal** (public, not a fork, no org copy)
**Genre:** maintenance-mode (captain's ruling: "I want those to just run themselves")

## State at audit (2026-07-07T03:00Z)

| Surface | State |
|---|---|
| Prod (`aquifer.klappy.dev/health`) | ok, **v1.6.2** — matches `main` package.json |
| Staging preview (`staging-aquifer-mcp.klappy.workers.dev`) | ok but **v0.9.0** — `staging` branch frozen 2026-03-20, ~3.5 months behind |
| Open issues / PRs (before this fly) | 0 / 0 |
| CI (`ci.yml`) | green on all recent runs (last: 2026-06-24) |
| `coverage-live.yml` (Mondays 08:00 UTC) | green, incl. this morning (2026-07-06) |
| Tags / GitHub releases | **none, ever** — release discipline is CHANGELOG + package.json + CF auto-deploy |
| Branch protection (main) | strict `build-test` required + PR reviews (0 approvals req'd) |
| Deploy topology | **merge to main = prod deploy** (Cloudflare Git integration); branches get preview URLs; Actions never deploy |
| npm audit | 0 vulnerabilities |
| Local test suite | 183/184 → **184/184 after PR #27** (the 1 failure was the maintenance loop flagging new org repo `text-align`) |

## can-finish-here — DONE this fly

1. **[PR #27](https://github.com/klappy/aquifer-mcp/pull/27)** — coverage manifest reconcile: new org repo `text-align` (appeared 2026-06-30, alignment tooling) categorized `excluded`, un-breaking the org-completeness test; **34 live-but-pending resources promoted to served** (closes journal P2 French flip + J-007 under-reporting debt); floor 23→57; `_audited` 2026-07-07. Zero regressions, zero unknowns vs live `list` (57 resources, 14 languages).
2. **[PR #28](https://github.com/klappy/aquifer-mcp/pull/28)** — lockfile-only in-range dep refresh: zod 4.3.6→4.4.3, vitest 3.2.4→3.2.7, wrangler 4.74→4.107, workers-types →4.20260702.1. package.json untouched. **Merge after #27** (CI shares the pre-existing coverage failure until then).
3. **Draft release v1.6.2** (unpublished, no tag minted) — first-ever tagged release proposal formalizing what prod serves. Publish or discard at captain's pleasure.

## needs-captain-ratification (batch surface — >3 items, per escalation trigger)

1. **MCP SDK 1.26.0 → 1.29.0** — exact-pinned deliberately; charter draft reserves protocol-surface bumps for captain. Tests would validate; say the word and a fly opens the PR.
2. **Major dep bumps**: workers-types 5.x, TypeScript 6.x, vitest 4.x, `agents` 0.7→0.17 (out-of-range). None urgent (0 CVEs). Suggest deferring until one of them blocks something.
3. **Stale branch deletion** — 4 unmerged `claude/*` branches + `feature/staging-deploy-telemetry-ci` (Mar–Apr, superseded by shipped work?) and merged `h11-eager-entity-index` (provably in main, deletable today). One `git push origin --delete` batch once blessed.
4. **Fast-forward `staging` to `main`** — one push, but it deploys the staging preview (0.9.0→1.6.2). Charter's monthly "staging-vs-prod parity" check currently fails badly.
5. **Journal P3 (carried since J-007): move the two live-hitting coverage assertions out of per-PR CI into `coverage-live.yml`** — the `text-align` episode proved the gap in the *other* direction too: org-completeness only runs on PRs, so a new org repo sits unflagged until someone happens to open one (6 days this time). Cleanest shape: scheduled workflow runs the full suite (or at least coverage tests) weekly; per-PR CI goes hermetic.
6. **LICENSE missing** — same blocker as transcode-mcp; one decision board covers both (already flagged by the charters fly).

## blocked-external

- 2 resources remain honestly `pending`: `PSLE`, `WestminsterLeningradCodex` — upstream content not yet served by the live indexer; nothing to do repo-side.
- Upstream `BibleAquifer` org changes arrive with no insider seat (ownership exposure noted in charter draft §7).

## release-candidate

- **v1.6.2 draft created** (see above). `[Unreleased]` gains only PR #27's manifest note — no code changes pending, so no *new* version is warranted; the draft formalizes the current one.
