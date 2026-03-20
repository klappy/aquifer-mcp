import type {
  Env,
  ResourceEntry,
  ArticleRef,
  ResourceMetadata,
  NavigabilityIndex,
} from "./types.js";
import { metadataUrl, fetchJson, fetchRepoSha, fetchOrgRepos, GC_TTL } from "./github.js";
import { isValidIndexReference } from "./references.js";

const INDEX_CACHE_KEY = "index:navigability:v6";

export async function getOrBuildIndex(env: Env): Promise<NavigabilityIndex> {
  const repoCodes = await fetchOrgRepos(env.AQUIFER_ORG, env);
  const repoShas = await fetchAllRepoShas(repoCodes, env);
  const compositeHash = await computeCompositeHash(repoShas);
  const cacheKey = `${compositeHash}:${INDEX_CACHE_KEY}`;

  const cached = await env.AQUIFER_CACHE.get(cacheKey, "json") as SerializedIndex | null;
  if (cached?.registry) {
    return deserializeIndex(cached);
  }

  const index = await buildIndex(repoCodes, env, repoShas);
  index.composite_sha = compositeHash;
  index.repo_shas = repoShas;

  try {
    await env.AQUIFER_CACHE.put(cacheKey, serializeIndex(index), {
      expirationTtl: GC_TTL,
    });
  } catch {
    // Index may exceed KV's 25 MiB value limit when many resources are included.
  }

  return index;
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

async function buildIndex(repoCodes: string[], env: Env, repoShas: Map<string, string>): Promise<NavigabilityIndex> {
  const registry: ResourceEntry[] = [];
  const passage = new Map<string, ArticleRef[]>();
  const entity = new Map<string, ArticleRef[]>();
  const title: ArticleRef[] = [];

  const results = await Promise.allSettled(
    repoCodes.map(async (code) => {
      const repoSha = repoShas.get(code);
      if (!repoSha) return null;
      const url = metadataUrl(env.AQUIFER_ORG, code, "eng");
      const cacheKey = `metadata:${code}:eng`;
      const metadata = await fetchJson<ResourceMetadata>(url, env, cacheKey, repoSha);
      if (!metadata?.resource_metadata) return null;
      return { code, metadata };
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { code, metadata } = result.value;
    const rm = metadata.resource_metadata;

    registry.push({
      resource_code: code,
      aquifer_type: rm.aquifer_type,
      resource_type: rm.resource_type,
      title: rm.title,
      short_name: rm.short_name ?? code,
      order: rm.order ?? "canonical",
      language: rm.language,
      localizations: rm.localizations ?? [],
      article_count: Object.keys(metadata.article_metadata ?? {}).length,
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

function serializeIndex(index: NavigabilityIndex): string {
  const serialized: SerializedIndex = {
    registry: index.registry,
    passage: Array.from(index.passage.entries()),
    entity: Array.from(index.entity.entries()),
    title: index.title,
    built_at: index.built_at,
    composite_sha: index.composite_sha,
    repo_shas: Array.from(index.repo_shas.entries()),
  };
  return JSON.stringify(serialized);
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
