# Protect `main` on GitHub

Branch protection lives in **GitHub** (not in git files). For **`klappy/aquifer-mcp`**, `main` is configured to require a **pull request**, **strict** passing of **`CI / build-test`**, **no force-push**, and **no branch deletion** (approvals required: **0** so solo maintainers can merge their own PRs after green CI). Adjust in **Settings → Branches** if your policy changes.

Use the **dashboard** or **`gh` CLI** (repo admin) to reproduce or edit rules.

**Repo:** `klappy/aquifer-mcp` · **default branch:** `main`  
**CI workflow:** `.github/workflows/ci.yml` · **name:** `CI` · **job id:** `build-test`  
**Required check name in GitHub UI:** usually **`CI / build-test`** (pick the exact row from a recent green run on a PR if it differs).

---

## Recommended rules (small team / solo-friendly)

| Setting | Value | Why |
|--------|--------|-----|
| **Require a pull request before merging** | On | No direct pushes to `main`; review + history. |
| **Require approvals** | `0` (solo) or `1+` (team) | `1` blocks self-merge unless you use bypass or a bot second pair of eyes. |
| **Dismiss stale pull request approvals when new commits are pushed** | On (if using approvals) | Keeps review tied to latest diff. |
| **Require status checks to pass** | On | Tie merges to green CI. |
| **Require branches to be up to date before merging** | On (strict) | Merges only if `main` tip + PR is tested together. |
| **Status checks required** | `CI / build-test` | Matches this repo’s workflow job. |
| **Do not allow bypassing the above settings** | Optional | Admins can always bypass unless you lock this down. |
| **Allow force pushes** | Off | |
| **Allow deletions** | Off | |

After the first successful **`CI`** run on a PR, open **Branch protection** → **Require status checks** → refresh the list and select **`CI / build-test`**.

---

## Dashboard path

1. GitHub → **klappy/aquifer-mcp** → **Settings** → **Branches**.
2. **Add branch protection rule** (or **Add rule** under Rulesets).
3. **Branch name pattern:** `main`.
4. Enable the options above and save.

*(If your org uses **Repository rulesets**, create a ruleset targeting `main` with equivalent constraints.)*

---

## CLI (repo admin token)

Requires `gh` authenticated with **`repo`** or **`admin:repo_hook`** scope as appropriate.

**Example:** require PR reviews (0 approvals), strict required check `CI / build-test`, no force-push/deletion:

```bash
gh api --method PUT "repos/klappy/aquifer-mcp/branches/main/protection" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["CI / build-test"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

If GitHub returns **422** about unknown context, run CI once on a PR, then re-run this with the **exact** check name from **Actions** → workflow run → job name.

---

## Related

- [`docs/branch-and-deployment-strategy.md`](branch-and-deployment-strategy.md) — branch roles and deploy flow.
