import type { Env } from "./types.js";

const GITHUB_RAW = "https://raw.githubusercontent.com";

// 30 days — garbage collection only, NOT a correctness mechanism.
// Correctness comes from the SHA check on every request.
export const GC_TTL = 2592000;

function rawUrl(org: string, repo: string, path: string): string {
  return `${GITHUB_RAW}/${org}/${repo}/main/${path}`;
}

export function metadataUrl(org: string, resourceCode: string, language: string): string {
  return rawUrl(org, resourceCode, `${language}/metadata.json`);
}

export function contentUrl(org: string, resourceCode: string, language: string, file: string): string {
  return rawUrl(org, resourceCode, `${language}/json/${file}`);
}

/**
 * Fetch the current commit SHA for a repo's main branch.
 * Uses conditional requests (If-None-Match) to avoid GitHub API rate limit hits.
 * Stores the ETag and SHA in KV for subsequent conditional requests.
 */
export async function fetchRepoSha(org: string, repo: string, env: Env): Promise<string> {
  const etagKey = `etag:${org}:${repo}`;
  const cachedShaKey = `sha:${org}:${repo}`;

  const [etag, cachedSha] = await Promise.all([
    env.AQUIFER_CACHE.get(etagKey),
    env.AQUIFER_CACHE.get(cachedShaKey),
  ]);

  const headers: Record<string, string> = {
    "User-Agent": "aquifer-mcp/0.6.0",
    "Accept": "application/vnd.github.v3.sha",
  };
  if (etag && cachedSha) headers["If-None-Match"] = etag;

  const resp = await fetch(
    `https://api.github.com/repos/${org}/${repo}/commits/main`,
    { headers },
  );

  if (resp.status === 304 && cachedSha) {
    // Not modified — cachedSha is still current. No rate limit hit.
    return cachedSha;
  }

  if (!resp.ok) {
    // GitHub unreachable — fall back to cached SHA if available.
    // This is a truthful degradation: we serve what we last verified,
    // not what a TTL claims is "probably" still valid.
    if (cachedSha) return cachedSha;
    throw new Error(`Cannot determine SHA for ${org}/${repo}: ${resp.status}`);
  }

  const newSha = (await resp.text()).trim();
  if (!newSha) {
    if (cachedSha) return cachedSha;
    throw new Error(`Empty SHA response for ${org}/${repo}`);
  }
  const newEtag = resp.headers.get("ETag");

  await Promise.all([
    env.AQUIFER_CACHE.put(cachedShaKey, newSha, { expirationTtl: GC_TTL }),
    newEtag ? env.AQUIFER_CACHE.put(etagKey, newEtag, { expirationTtl: GC_TTL }) : Promise.resolve(),
  ]);

  return newSha;
}

/**
 * Fetch JSON from a URL with optional SHA-keyed KV caching.
 * When sha is provided, the cache key becomes `{sha}:{cacheKey}` — content-addressed.
 * Without sha, no caching occurs (enforces anti-cache-lying constraint).
 */
export async function fetchJson<T>(url: string, env?: Env, cacheKey?: string, sha?: string): Promise<T | null> {
  const resolvedKey = sha && cacheKey ? `${sha}:${cacheKey}` : undefined;

  if (env && resolvedKey) {
    const cached = await env.AQUIFER_CACHE.get(resolvedKey, "json");
    if (cached) return cached as T;
  }

  const resp = await fetch(url, {
    headers: { "User-Agent": "aquifer-mcp/0.6.0" },
  });

  if (!resp.ok) return null;

  const data = await resp.json() as T;

  if (env && resolvedKey) {
    await env.AQUIFER_CACHE.put(resolvedKey, JSON.stringify(data), {
      expirationTtl: GC_TTL,
    });
  }

  return data;
}
