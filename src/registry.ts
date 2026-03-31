import type {
  Env,
  ResourceEntry,
  ArticleRef,
  ResourceMetadata,
  NavigabilityIndex,
} from "./types.js";
import { metadataUrl, fetchJson, fetchRepoSha, fetchOrgRepos, GC_TTL } from "./github.js";
import { isValidIndexReference } from "./references.js";
import { AquiferStorage, indexKey, metadataKey } from "./storage.js";

const LATEST_SHA_KEY = "index:latest-composite-sha";
const SHA_STALE_MS = 5 * 60 * 1000; // 5 minutes

export async function getOrBuildIndex(env: Env, storage: AquiferStorage, ctx?: ExecutionContext): Promise<NavigabilityIndex> {
  // --- HOT PATH: pointer (KV) → index (R2 via Cache API) ---
  const latestSha = await env.AQUIFER_CACHE.get(LATEST_SHA_KEY, "json") as { sha: string; checked_at: number } | null;
  if (latestSha?.sha) {
    const key = indexKey(latestSha.sha);
    const { data } = await storage.getJSON<SerializedIndex>(key);
    if (data?.registry) {
      const index = deserializeIndex(data);
      // Schedule background refresh if stale
      if (ctx && Date.now() - latestSha.checked_at > SHA_STALE_MS) {
        ctx.waitUntil(refreshShasIfStale(env, storage));
      }
      return index;
    }
  }

  // --- COLD PATH: no cached index, build from scratch ---
  const repoCodes = await fetchOrgRepos(env.AQUIFER_ORG, env);
  const repoShas = await fetchAllRepoShas(repoCodes, env);
  const compositeHash = await computeCompositeHash(repoShas);
  const key = indexKey(compositeHash);

  // Check R2 for this composite (pointer was missing but index may exist)
  const { data: existing } = await storage.getJSON<SerializedIndex>(key);
  if (existing?.registry) {
    await updatePointer(env, compositeHash);
    return deserializeIndex(existing);
  }

  const index = await buildIndex(repoCodes, env, storage, repoShas);
  index.composite_sha = compositeHash;
  index.repo_shas = repoShas;

  // Store in R2 (no size limit!)
  const written = await storage.putJSON(key, serializeForStorage(index));
  if (written) {
    await updatePointer(env, compositeHash);
  }
  // Pointer only advances if write succeeded (bugbot fix preserved)

  return index;
}

async function updatePointer(env: Env, sha: string): Promise<void> {
  await env.AQUIFER_CACHE.put(LATEST_SHA_KEY, JSON.stringify({ sha, checked_at: Date.now() }), {
    expirationTtl: GC_TTL,
  });
}

async function refreshShasIfStale(env: Env, storage: AquiferStorage): Promise<void> {
  try {
    const repoCodes = await fetchOrgRepos(env.AQUIFER_ORG, env);
    const repoShas = await fetchAllRepoShas(repoCodes, env);
    const compositeHash = await computeCompositeHash(repoShas);

    const currentPointer = await env.AQUIFER_CACHE.get(LATEST_SHA_KEY, "json") as { sha: string } | null;
    if (currentPointer?.sha === compositeHash) {
      // No change — just update checked_at timestamp
      await updatePointer(env, compositeHash);
      return;
    }

    // SHA changed — check if index already exists in R2
    const key = indexKey(compositeHash);
    const { data: existing } = await storage.getJSON<SerializedIndex>(key);
    if (existing?.registry) {
      await updatePointer(env, compositeHash);
      return;
    }

    // Build fresh index in background
    const index = await buildIndex(repoCodes, env, storage, repoShas);
    index.composite_sha = compositeHash;
    index.repo_shas = repoShas;

    const written = await storage.putJSON(key, serializeForStorage(index));
    if (written) {
      await updatePointer(env, compositeHash);
    }
  } catch {
    // Background refresh failed — stale pointer remains valid (truthful degradation)
  }
}

async function fetchAllRepoShas(repoCodes: string[], env: Env): Promise<Map<string, string>> {
  const results = await Promise.allSettled(
    repoCodes.map(async (code) => {
      const sha = await fetchRepoSha(env.AQUIFER_ORG, code, env);
      return { code, sha };
    }),
  );
  const map = new Map<string, string>();
  for (const r of results) {
    if (r.status === "fulfilled") map.set(r.value.code, r.value.sha);
  }
  return map;
}

async function computeCompositeHash(repoShas: Map<string, string>): Promise<string> {
  const parts = [...repoShas.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, sha]) => `${code}:${sha}`)
    .join(",");
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function buildIndex(
  repoCodes: string[],
  env: Env,
  storage: AquiferStorage,
  repoShas: Map<string, string>,
): Promise<NavigabilityIndex> {
  const registry: ResourceEntry[] = [];
  const passage = new Map<string, ArticleRef[]>();
  const entity = new Map<string, ArticleRef[]>();
  const title: ArticleRef[] = [];

  const results = await Promise.allSettled(
    repoCodes.map(async (code) => {
      const repoSha = repoShas.get(code);
      if (!repoSha) return null;
      const url = metadataUrl(env.AQUIFER_ORG, code, "eng");
      const key = metadataKey(code, repoSha, "eng");
      const metadata = await fetchJson<ResourceMetadata>(url, storage, key);
      if (!metadata?.resource_metadata) return null;
      return { code, metadata };
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { code, metadata } = result.value;
    const rm = metadata.resource_metadata;

    // Compute article count — Bible resources may lack article_metadata
    let articleCount = Object.keys(metadata.article_metadata ?? {}).length;
    if (articleCount === 0 && (rm.order === "canonical" || rm.aquifer_type.toLowerCase() === "bible")) {
      const ingredients = Object.keys(metadata.scripture_burrito?.ingredients ?? {});
      const contentFiles = ingredients.filter(k => k.startsWith("json/") && k.endsWith(".content.json"));
      if (contentFiles.length > 0) {
        articleCount = contentFiles.length;
      }
    }

    registry.push({
      resource_code: code,
      aquifer_type: rm.aquifer_type,
      resource_type: rm.resource_type,
      title: rm.title,
      short_name: rm.short_name ?? code,
      order: rm.order ?? "canonical",
      language: rm.language,
      localizations: rm.localizations ?? [],
      article_count: articleCount,
      version: rm.version,
    });

    if (!metadata.article_metadata) continue;

    for (const [contentId, article] of Object.entries(metadata.article_metadata)) {
      const fallbackTitle = article.index_reference && !isValidIndexReference(article.index_reference)
        ? article.index_reference
        : `Article ${contentId}`;
      const englishTitle = article.localizations?.eng?.title ?? article.title ?? fallbackTitle;
      const baseRef: ArticleRef = {
        resource_code: code,
        language: rm.language,
        content_id: contentId,
        title: englishTitle,
        resource_type: rm.resource_type,
        index_reference: article.index_reference,
      };

      title.push(baseRef);

      if (article.index_reference && isValidIndexReference(article.index_reference)) {
        const existing = passage.get(article.index_reference);
        if (existing) {
          existing.push(baseRef);
        } else {
          passage.set(article.index_reference, [baseRef]);
        }
      }
    }
  }

  return { registry, passage, entity, title, built_at: Date.now(), composite_sha: "", repo_shas: repoShas };
}

interface SerializedIndex {
  registry: ResourceEntry[];
  passage: Array<[string, ArticleRef[]]>;
  entity: Array<[string, ArticleRef[]]>;
  title: ArticleRef[];
  built_at: number;
  composite_sha: string;
  repo_shas: Array<[string, string]>;
}

function serializeForStorage(index: NavigabilityIndex): SerializedIndex {
  return {
    registry: index.registry,
    passage: Array.from(index.passage.entries()),
    entity: Array.from(index.entity.entries()),
    title: index.title,
    built_at: index.built_at,
    composite_sha: index.composite_sha,
    repo_shas: Array.from(index.repo_shas.entries()),
  };
}

function deserializeIndex(data: SerializedIndex): NavigabilityIndex {
  return {
    registry: data.registry,
    passage: new Map(data.passage),
    entity: new Map(data.entity),
    title: data.title ?? [],
    built_at: data.built_at,
    composite_sha: data.composite_sha ?? "",
    repo_shas: new Map(data.repo_shas ?? []),
  };
}
