# GitHub branch protection (`main` vs `staging`)

Rules live in **GitHub** → **Settings → Branches** (or `gh api`). **`klappy/aquifer-mcp`**

---

## `main` — strict (production lineage)

| Rule | Setting |
|------|---------|
| Pull request before merging | **Yes** (`required_pull_request_reviews`, **0** approvals) |
| Dismiss stale reviews | Yes |
| Status checks | **`CI / build-test`** required |
| Strict (up to date) | **Yes** |
| Force pushes | **Off** |
| Branch deletion | **Off** |

---

## `staging` — light (integration branch)

| Rule | Setting |
|------|---------|
| Pull request before merging | **No** — direct pushes allowed for fast integration |
| Status checks | **None required** — merge/push to `staging` does not wait on CI |
| Strict | n/a (no checks) |
| Force pushes | **Off** — history cannot be rewritten on `staging` |
| Branch deletion | **Off** — branch cannot be deleted accidentally |

**Why softer than `main`:** pre-prod branch needs quick iteration and Cloudflare preview deploys without a mandatory PR or green check. **Why still protected:** no **force-push** and no **deletion** keeps branch history and the branch itself recoverable.

**CI note:** With `.github/workflows/ci.yml`, **`push` only runs on `main`**, so pushes to `staging` do not start CI from `push`; **PRs** into `staging` still run CI. To require CI before updating `staging`, use PRs instead of direct push.

---

## CLI reference (repo admin)

**`staging` (light)** — re-apply after edits:

```bash
gh api --method PUT "repos/klappy/aquifer-mcp/branches/staging/protection" --input - <<'EOF'
{
  "required_status_checks": { "strict": false, "contexts": [] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

**`main` (strict)** — see historical application in git history / team notes; requires `required_pull_request_reviews` object and `contexts: ["CI / build-test"]`, `strict: true`.

---

## Related

- [`docs/branch-and-deployment-strategy.md`](branch-and-deployment-strategy.md)
