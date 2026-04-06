# PR: Fix Anti-Cache Lying violation in readme tool + remove hardcoded tool count

## Problem

Two issues in README / readme tool:

### 1. `handleReadme` uses static cache key — Anti-Cache Lying violation

`handleReadme` (src/tools.ts L85–115) uses cache key `"readme:v1:main"` with `GC_TTL`. This is TTL-as-freshness, not content-addressed caching. The README served "version 0.9.0" for months after the project reached 1.5.0 because nothing in the cache path observes repo state.

Canon reference: `odd/constraint/anti-cache-lying.md` — "A cache with a TTL serves a past observation as current truth — a polite lie."

Prior incident: `docs/incidents/oddkit-stale-cache-2026-02.md` — oddkit had the identical bug.

### 2. README has hardcoded tool count

Line 39: `"Aquifer MCP provides ten tools:"` — goes stale every time tools are added or removed.

## Fix

### README.md

Change:
```
Aquifer MCP provides ten tools:
```
To:
```
Aquifer MCP provides these tools:
```

### src/tools.ts — `handleReadme`

Replace the static cache key with a SHA-keyed cache key using the existing `fetchRepoSha` function from `src/github.ts`.

**Before (current, broken):**
```ts
export async function handleReadme(
  args: Record<string, unknown>,
  env: Env,
) {
  const refresh = Boolean(args.refresh);
  const cacheKey = "readme:v1:main";

  if (!refresh) {
    const cached = await env.AQUIFER_CACHE.get(cacheKey);
    if (cached) return textResult(cached);
  }

  try {
    const resp = await fetch(README_RAW_URL, {
      headers: { "User-Agent": `aquifer-mcp/${VERSION}` },
    });
    if (!resp.ok) {
      const cached = await env.AQUIFER_CACHE.get(cacheKey);
      if (cached) return textResult(cached);
      return textResult(`Failed to fetch README (${resp.status}).`);
    }

    const readme = await resp.text();
    await env.AQUIFER_CACHE.put(cacheKey, readme, { expirationTtl: GC_TTL });
    return textResult(readme);
  } catch {
    const cached = await env.AQUIFER_CACHE.get(cacheKey);
    if (cached) return textResult(cached);
    return textResult("Failed to fetch README.");
  }
}
```

**After (content-addressed):**
```ts
export async function handleReadme(
  args: Record<string, unknown>,
  env: Env,
) {
  const sha = await fetchRepoSha("klappy", "aquifer-mcp", env);
  const cacheKey = `readme:v1:${sha}`;

  const cached = await env.AQUIFER_CACHE.get(cacheKey);
  if (cached) return textResult(cached);

  try {
    const resp = await fetch(README_RAW_URL, {
      headers: { "User-Agent": `aquifer-mcp/${VERSION}` },
    });
    if (!resp.ok) {
      return textResult(`Failed to fetch README (${resp.status}).`);
    }

    const readme = await resp.text();
    await env.AQUIFER_CACHE.put(cacheKey, readme, { expirationTtl: GC_TTL });
    return textResult(readme);
  } catch {
    return textResult("Failed to fetch README.");
  }
}
```

Key changes:
- Cache key includes SHA from `fetchRepoSha("klappy", "aquifer-mcp", env)` — same function already used throughout the codebase for BibleAquifer repos.
- `refresh` parameter is no longer needed — SHA change = automatic cache miss. The tool schema can keep `refresh` if desired but it becomes a no-op since the SHA already guarantees freshness.
- Stale-cache fallback on fetch failure is removed. If the SHA changed but GitHub is unreachable, `fetchRepoSha` itself falls back to the last-known SHA (see github.ts L102), so the cache key still resolves to the previous valid entry. No need for a second fallback layer.

**Import:** `fetchRepoSha` is already exported from `src/github.ts`. Add it to the import line at the top of tools.ts (L3):
```ts
import { contentUrl, metadataUrl, fetchJson, GC_TTL, fetchRepoSha } from "./github.js";
```

## Verification

After deploy:
1. `curl https://aquifer.klappy.dev/health` — confirm deploy
2. Call `readme` tool — confirm no "0.9.0", confirms "these tools" (not "ten tools")
3. Confirm `x-aquifer-trace` shows `fetchRepoSha` subrequest (one additional KV read on cold path, zero on warm)
