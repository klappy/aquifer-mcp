import type { Env } from "./types.js";

const GITHUB_RAW = "https://raw.githubusercontent.com";
const CACHE_TTL = 86400; // 24 hours

function rawUrl(org: string, repo: string, path: string): string {
  return `${GITHUB_RAW}/${org}/${repo}/main/${path}`;
}

export function metadataUrl(org: string, resourceCode: string, language: string): string {
  return rawUrl(org, resourceCode, `${language}/metadata.json`);
}

export function contentUrl(org: string, resourceCode: string, language: string, file: string): string {
  return rawUrl(org, resourceCode, `${language}/json/${file}`);
}

export async function fetchJson<T>(url: string, env?: Env, cacheKey?: string): Promise<T | null> {
  if (env && cacheKey) {
    const cached = await env.AQUIFER_CACHE.get(cacheKey, "json");
    if (cached) return cached as T;
  }

  const resp = await fetch(url, {
    headers: { "User-Agent": "aquifer-mcp/0.1" },
  });

  if (!resp.ok) return null;

  const data = await resp.json() as T;

  if (env && cacheKey) {
    await env.AQUIFER_CACHE.put(cacheKey, JSON.stringify(data), {
      expirationTtl: CACHE_TTL,
    });
  }

  return data;
}

export async function fetchContentFile(
  org: string,
  resourceCode: string,
  language: string,
  file: string,
  env?: Env,
): Promise<unknown[] | null> {
  const url = contentUrl(org, resourceCode, language, file);
  const cacheKey = `content:${resourceCode}:${language}:${file}`;
  return fetchJson<unknown[]>(url, env, cacheKey);
}

export async function fetchGovernanceSha(org: string, docsRepo: string): Promise<string | null> {
  const resp = await fetch(
    `https://api.github.com/repos/${org}/${docsRepo}/commits/main`,
    {
      headers: {
        "User-Agent": "aquifer-mcp/0.1",
        Accept: "application/vnd.github.v3.sha",
      },
    },
  );
  if (!resp.ok) return null;
  return (await resp.text()).trim();
}
