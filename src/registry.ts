import type {
  Env,
  ResourceEntry,
  ArticleRef,
  ResourceMetadata,
  NavigabilityIndex,
} from "./types.js";
import { metadataUrl, fetchJson } from "./github.js";
import { isValidIndexReference } from "./references.js";

const KNOWN_REPOS: Array<{ code: string; order: "canonical" | "alphabetical" | "monograph" }> = [
  { code: "TyndaleStudyNotes", order: "canonical" },
  { code: "BiblicaStudyNotes", order: "canonical" },
  { code: "TyndaleStudyNotesBookIntros", order: "canonical" },
  { code: "AquiferOpenStudyNotes", order: "canonical" },
  { code: "AquiferOpenStudyNotesBookIntros", order: "canonical" },
  { code: "TyndaleBibleDictionary", order: "alphabetical" },
  { code: "BiblicaStudyNotesKeyTerms", order: "alphabetical" },
  { code: "FIAKeyTerms", order: "alphabetical" },
  { code: "AquiferOpenBibleDictionary", order: "alphabetical" },
  { code: "UWTranslationWords", order: "alphabetical" },
  { code: "UWTranslationNotes", order: "canonical" },
  { code: "UWTranslationQuestions", order: "canonical" },
  { code: "UWOpenBibleStories", order: "monograph" },
  { code: "FIATranslationGuide", order: "monograph" },
  { code: "UbsImages", order: "alphabetical" },
  { code: "FIAImages", order: "alphabetical" },
  { code: "FIAMaps", order: "alphabetical" },
];

const INDEX_CACHE_KEY = "index:navigability:v4";
const INDEX_TTL = 86400;

export async function getOrBuildIndex(env: Env): Promise<NavigabilityIndex> {
  const cached = await env.AQUIFER_CACHE.get(INDEX_CACHE_KEY, "json") as SerializedIndex | null;
  if (cached?.registry) {
    return deserializeIndex(cached);
  }

  const index = await buildIndex(env);

  await env.AQUIFER_CACHE.put(INDEX_CACHE_KEY, serializeIndex(index), {
    expirationTtl: INDEX_TTL,
  });

  return index;
}

async function buildIndex(env: Env): Promise<NavigabilityIndex> {
  const registry: ResourceEntry[] = [];
  const passage = new Map<string, ArticleRef[]>();
  const entity = new Map<string, ArticleRef[]>();
  const title: ArticleRef[] = [];

  const results = await Promise.allSettled(
    KNOWN_REPOS.map(async (repo) => {
      const url = metadataUrl(env.AQUIFER_ORG, repo.code, "eng");
      const cacheKey = `metadata:${repo.code}:eng`;
      const metadata = await fetchJson<ResourceMetadata>(url, env, cacheKey);
      if (!metadata?.resource_metadata) return null;
      return { repo, metadata };
    }),
  );

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { repo, metadata } = result.value;
    const rm = metadata.resource_metadata;

    registry.push({
      resource_code: repo.code,
      aquifer_type: rm.aquifer_type,
      resource_type: rm.resource_type,
      title: rm.title,
      short_name: rm.short_name ?? repo.code,
      order: rm.order ?? repo.order,
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
        resource_code: repo.code,
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

  return { registry, passage, entity, title, built_at: Date.now() };
}

interface SerializedIndex {
  registry: ResourceEntry[];
  passage: Array<[string, ArticleRef[]]>;
  entity: Array<[string, ArticleRef[]]>;
  title: ArticleRef[];
  built_at: number;
}

function serializeIndex(index: NavigabilityIndex): string {
  const serialized: SerializedIndex = {
    registry: index.registry,
    passage: Array.from(index.passage.entries()),
    entity: Array.from(index.entity.entries()),
    title: index.title,
    built_at: index.built_at,
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
  };
}
