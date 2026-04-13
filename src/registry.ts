import type {
  Env,
  ResourceEntry,
  ArticleRef,
  ResourceMetadata,
  NavigabilityIndex,
} from "./types.js";
import { metadataUrl, fetchJson, fetchRepoSha, fetchOrgRepos } from "./github.js";
import { isValidIndexReference, rangesOverlap } from "./references.js";
import { AquiferStorage, indexKey, metadataKey, passageIndexKey, titleIndexKey, articleIndexKey } from "./storage.js";

/** Per-resource article lookup: content_id → file location + minimal metadata. */
export interface ArticleLookupEntry {
  file: string;
  ref: string;
  title: string;
}
import type { RequestTracer } from "./tracing.js";

/** Well-known R2 key for the current index — eliminates KV pointer read from hot path. */
const CURRENT_INDEX_KEY = "index/current/navigability.json";
const SHA_STALE_MS = 15 * 60 * 1000; // 15 minutes
const INDEX_MEMORY_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Module-level memory cache — survives across requests within the same isolate. */
let cachedIndex: NavigabilityIndex | null = null;
let indexFetchedAt = 0;

export async function getOrBuildIndex(env: Env, storage: AquiferStorage, ctx?: ExecutionContext, tracer?: RequestTracer): Promise<NavigabilityIndex> {
  // --- Tier 1: Module-level memory cache (0 subrequests) ---
  if (cachedIndex && Date.now() - indexFetchedAt < INDEX_MEMORY_TTL_MS) {
    tracer?.addSpan("index", 0, "memory");
    return cachedIndex;
  }

  // --- Tier 2: Well-known R2 key via Cache API (1 subrequest max) ---
  const { data } = await storage.getJSON<SerializedIndex>(CURRENT_INDEX_KEY, tracer);
  if (data?.registry) {
    const index = deserializeIndex(data);
    cachedIndex = index;
    indexFetchedAt = Date.now();

    // Background refresh if SHAs are stale
    if (ctx && (!data.checked_at || Date.now() - data.checked_at > SHA_STALE_MS)) {
      ctx.waitUntil(refreshAndUpdateCurrentIndex(env, storage));
    }

    return index;
  }

  // --- Tier 3: Cold build (no cached index exists) ---
  tracer?.addSpan("cold-path", 0, undefined, "no cached index, rebuilding");

  const orgStart = performance.now();
  const repoCodes = await fetchOrgRepos(env.AQUIFER_ORG, env);
  tracer?.addSpan("org-repos", Math.round(performance.now() - orgStart), "kv", `${repoCodes.length} repos`);

  const shaStart = performance.now();
  const repoShas = await fetchAllRepoShas(repoCodes, env);
  tracer?.addSpan("repo-shas", Math.round(performance.now() - shaStart), "github", `${repoShas.size} resolved`);

  const compositeHash = await computeCompositeHash(repoShas);
  const shaKey = indexKey(compositeHash);

  // Check R2 for this composite (well-known key was missing but SHA-keyed index may exist)
  const { data: existing } = await storage.getJSON<SerializedIndex>(shaKey, tracer);
  if (existing?.registry) {
    existing.checked_at = Date.now();
    await Promise.all([
      storage.putJSON(shaKey, existing),
      storage.putJSON(CURRENT_INDEX_KEY, existing),
    ]);
    const index = deserializeIndex(existing);
    cachedIndex = index;
    indexFetchedAt = Date.now();
    return index;
  }

  const buildStart = performance.now();
  const index = await buildIndex(repoCodes, env, storage, repoShas);
  tracer?.addSpan("index-build", Math.round(performance.now() - buildStart), undefined, `${index.registry.length} resources`);
  index.composite_sha = compositeHash;
  index.repo_shas = repoShas;

  // Store in R2: SHA-keyed (immutable) + well-known current (mutable)
  const serialized = serializeForStorage(index);
  serialized.checked_at = Date.now();
  const writeStart = performance.now();
  const written = await storage.putJSON(shaKey, serialized);
  tracer?.addSpan("r2-write", Math.round(performance.now() - writeStart), "r2");
  if (written) {
    await storage.putJSON(CURRENT_INDEX_KEY, serialized);
  }

  cachedIndex = index;
  indexFetchedAt = Date.now();
  return index;
}

async function refreshAndUpdateCurrentIndex(env: Env, storage: AquiferStorage): Promise<void> {
  try {
    const repoCodes = await fetchOrgRepos(env.AQUIFER_ORG, env);
    const repoShas = await fetchAllRepoShas(repoCodes, env);
    const compositeHash = await computeCompositeHash(repoShas);

    // Read current to check if SHA changed
    const { data: current } = await storage.getJSON<SerializedIndex>(CURRENT_INDEX_KEY);
    if (current?.composite_sha === compositeHash) {
      // No change — update checked_at only
      current.checked_at = Date.now();
      await storage.putJSON(CURRENT_INDEX_KEY, current);
      return;
    }

    // SHA changed — check if index already exists in R2
    const shaKey = indexKey(compositeHash);
    const { data: existing } = await storage.getJSON<SerializedIndex>(shaKey);
    if (existing?.registry) {
      existing.checked_at = Date.now();
      await Promise.all([
        storage.putJSON(shaKey, existing),
        storage.putJSON(CURRENT_INDEX_KEY, existing),
      ]);
      // Update module-level cache
      cachedIndex = deserializeIndex(existing);
      indexFetchedAt = Date.now();
      return;
    }

    // Build fresh index in background
    const index = await buildIndex(repoCodes, env, storage, repoShas);
    index.composite_sha = compositeHash;
    index.repo_shas = repoShas;

    const serialized = serializeForStorage(index);
    serialized.checked_at = Date.now();
    const written = await storage.putJSON(shaKey, serialized);
    if (written) {
      await storage.putJSON(CURRENT_INDEX_KEY, serialized);
      // Update module-level cache
      cachedIndex = index;
      indexFetchedAt = Date.now();
    }
  } catch {
    // Background refresh failed — current index remains valid (truthful degradation)
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
  const rejected: string[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      map.set(r.value.code, r.value.sha);
    } else {
      rejected.push(`${repoCodes[i]}: ${r.reason?.message ?? "unknown"}`);
    }
  }
  if (rejected.length > 0) {
    console.error(
      `fetchAllRepoShas: ${rejected.length}/${repoCodes.length} repos failed SHA fetch — these will be EXCLUDED from index:`,
      rejected,
    );
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

  const writePromises: Promise<unknown>[] = [];

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

    const resourcePassage = new Map<string, ArticleRef[]>();
    const resourceTitles: ArticleRef[] = [];
    const articleLookup: Record<string, ArticleLookupEntry> = {};

    for (const [contentId, article] of Object.entries(metadata.article_metadata)) {
      const fallbackTitle = article.index_reference && !isValidIndexReference(article.index_reference)
        ? article.index_reference
        : `Article ${contentId}`;
      const englishTitle = article.localizations?.eng?.title ?? article.title ?? fallbackTitle;
      const ref = article.index_reference ?? "";
      const baseRef: ArticleRef = {
        resource_code: code,
        language: rm.language,
        content_id: contentId,
        title: englishTitle,
        resource_type: rm.resource_type,
        index_reference: article.index_reference,
      };

      resourceTitles.push(baseRef);

      if (article.index_reference && isValidIndexReference(article.index_reference)) {
        const existing = resourcePassage.get(article.index_reference);
        if (existing) {
          existing.push(baseRef);
        } else {
          resourcePassage.set(article.index_reference, [baseRef]);
        }
      }

      // Article lookup: derive file from index_reference for canonical, empty for non-canonical
      let file = "";
      if (rm.order === "canonical" && ref.length >= 2 && /^\d{2}/.test(ref)) {
        file = `${ref.slice(0, 2)}.content.json`;
      }
      articleLookup[contentId] = { file, ref, title: englishTitle };
    }

    const repoSha = repoShas.get(code)!;

    // For non-canonical resources, assign files using scripture_burrito ingredients
    if (rm.order !== "canonical") {
      const ingredientKeys = Object.keys(metadata.scripture_burrito?.ingredients ?? {});
      const contentFiles = ingredientKeys
        .filter(k => k.startsWith("json/") && k.endsWith(".content.json"))
        .map(k => k.replace(/^json\//, ""))
        .sort();

      if (contentFiles.length > 0) {
        // Distribute articles across files in order (articles are grouped by file)
        // For each article, assign the file based on article ordering or fallback to first file
        const unassigned = Object.entries(articleLookup).filter(([, v]) => !v.file);
        if (unassigned.length > 0 && contentFiles.length === 1) {
          // Single file — all articles go there
          for (const [, entry] of unassigned) entry.file = contentFiles[0]!;
        }
        // For multi-file non-canonical: leave file empty (resolved at query time via KV hint or scan)
        // The article index still provides ref + title for browse/search without file scanning
      }
    }

    // Collect per-resource index writes to parallelize across all resources
    if (resourcePassage.size > 0) {
      writePromises.push(storage.putJSON(passageIndexKey(code, repoSha), Array.from(resourcePassage.entries())));
    }
    if (resourceTitles.length > 0) {
      writePromises.push(storage.putJSON(titleIndexKey(code, repoSha), resourceTitles));
    }
    if (Object.keys(articleLookup).length > 0) {
      writePromises.push(storage.putJSON(articleIndexKey(code, repoSha), articleLookup));
    }
  }

  // Write all per-resource indexes to R2 in parallel
  await Promise.allSettled(writePromises);

  // Return lightweight index — passage/title/entity are empty.
  // Queries use fan-out functions to load per-resource indexes on demand.
  return {
    registry,
    passage: new Map(),
    entity: new Map(),
    title: [],
    built_at: Date.now(),
    composite_sha: "",
    repo_shas: repoShas,
  };
}

// --- Fan-out query functions ---

/**
 * Search passages across all resources by loading per-resource passage indexes in parallel.
 * Falls back to in-memory index.passage if populated (e.g. in tests).
 */
export async function fanOutPassageSearch(
  ref: string,
  index: NavigabilityIndex,
  storage: AquiferStorage,
  tracer?: RequestTracer,
): Promise<ArticleRef[]> {
  // If passage data is already in memory (tests provide this), use it directly
  if (index.passage.size > 0) {
    const matches: ArticleRef[] = [];
    for (const [range, refs] of index.passage) {
      if (rangesOverlap(ref, range)) matches.push(...refs);
    }
    return matches;
  }

  // Fan out: load per-resource passage indexes in parallel
  const fanStart = performance.now();
  let hits = 0;
  let misses = 0;

  const results = await Promise.allSettled(
    index.registry.map(async (entry) => {
      const sha = index.repo_shas.get(entry.resource_code);
      if (!sha) { misses++; return []; }
      const key = passageIndexKey(entry.resource_code, sha);
      const { data } = await storage.getJSON<Array<[string, ArticleRef[]]>>(key, tracer);
      if (!data) { misses++; return []; }
      hits++;
      const matches: ArticleRef[] = [];
      for (const [range, refs] of data) {
        if (rangesOverlap(ref, range)) matches.push(...refs);
      }
      return matches;
    }),
  );

  tracer?.addSpan("fanout-passages", Math.round(performance.now() - fanStart), undefined,
    `${index.registry.length} resources, ${hits} hits, ${misses} misses`);

  const matches: ArticleRef[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") matches.push(...r.value);
  }
  return matches;
}

/**
 * Search titles across all resources by loading per-resource title indexes in parallel.
 * Falls back to in-memory index.title if populated (e.g. in tests).
 */
export async function fanOutTitleSearch(
  terms: string[],
  index: NavigabilityIndex,
  storage: AquiferStorage,
  tracer?: RequestTracer,
): Promise<ArticleRef[]> {
  // If title data is already in memory (tests provide this), use it directly
  if (index.title.length > 0) {
    const matches: ArticleRef[] = [];
    for (const ref of index.title) {
      const title = ref.title.toLowerCase();
      if (terms.every((t) => title.includes(t))) matches.push(ref);
    }
    return matches;
  }

  // Fan out: load per-resource title indexes in parallel
  const fanStart = performance.now();
  let hits = 0;
  let misses = 0;

  const results = await Promise.allSettled(
    index.registry.map(async (entry) => {
      const sha = index.repo_shas.get(entry.resource_code);
      if (!sha) { misses++; return []; }
      const key = titleIndexKey(entry.resource_code, sha);
      const { data } = await storage.getJSON<ArticleRef[]>(key, tracer);
      if (!data) { misses++; return []; }
      hits++;
      return data.filter((ref) => {
        const title = ref.title.toLowerCase();
        return terms.every((t) => title.includes(t));
      });
    }),
  );

  tracer?.addSpan("fanout-titles", Math.round(performance.now() - fanStart), undefined,
    `${index.registry.length} resources, ${hits} hits, ${misses} misses`);

  const matches: ArticleRef[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") matches.push(...r.value);
  }
  return matches;
}

/**
 * Load the article lookup index for a single resource.
 * Returns a map of content_id → { file, ref, title }.
 */
export async function loadArticleLookup(
  resourceCode: string,
  sha: string,
  storage: AquiferStorage,
  tracer?: RequestTracer,
): Promise<Record<string, ArticleLookupEntry> | null> {
  const key = articleIndexKey(resourceCode, sha);
  const { data } = await storage.getJSON<Record<string, ArticleLookupEntry>>(key, tracer);
  return data;
}

// --- Serialization ---

interface SerializedIndex {
  registry: ResourceEntry[];
  passage: Array<[string, ArticleRef[]]>;
  entity: Array<[string, ArticleRef[]]>;
  title: ArticleRef[];
  built_at: number;
  composite_sha: string;
  repo_shas: Array<[string, string]>;
  checked_at: number; // when SHAs were last verified against GitHub
}

function serializeForStorage(index: NavigabilityIndex): SerializedIndex {
  return {
    registry: index.registry,
    passage: [], // Per-resource indexes stored separately in R2
    entity: [], // Entity data bootstrapped on demand
    title: [], // Per-resource indexes stored separately in R2
    built_at: index.built_at,
    composite_sha: index.composite_sha,
    repo_shas: Array.from(index.repo_shas.entries()),
    checked_at: 0,
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
