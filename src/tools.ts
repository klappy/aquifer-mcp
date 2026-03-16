import type { Env, ArticleRef, ArticleContent, NavigabilityIndex, ResourceEntry, ResourceMetadata } from "./types.js";
import { parseReference, rangesOverlap, rangeToReadable, isValidIndexReference } from "./references.js";
import { contentUrl, metadataUrl, fetchJson } from "./github.js";
import { getOrBuildIndex } from "./registry.js";

export const TOOL_DEFINITIONS = [
  {
    name: "list",
    description:
      "List available Aquifer resources with type, language, article count, and coverage. Use this to discover what the Aquifer contains before searching.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: {
          type: "string",
          description:
            'Filter by resource type: StudyNotes, Dictionary, Guide, Bible, Images, Videos. Omit for all.',
        },
        language: {
          type: "string",
          description: "Filter by language code (e.g. eng, spa, fra). Omit for all.",
        },
      },
    },
  },
  {
    name: "search",
    description:
      'Search Aquifer articles by passage reference ("Romans 3:24", "ROM 3:24", "45003024"), ACAI entity ID ("keyterm:Justification"), or keyword in article titles. Returns article references, not full content — use get to fetch details.',
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            'A passage reference (e.g. "ROM 3:24", "Romans 3:21-26", "45003024"), ACAI entity (e.g. "keyterm:Justification", "person:Paul"), or keyword to search article titles.',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get",
    description:
      "Fetch a specific Aquifer article by its compound key (resource_code + language + content_id). Returns full content with all associations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        resource_code: { type: "string", description: "The resource repository name (e.g. BiblicaStudyNotes)." },
        language: { type: "string", description: "Language code (e.g. eng)." },
        content_id: { type: "string", description: "The article content ID." },
      },
      required: ["resource_code", "language", "content_id"],
    },
  },
  {
    name: "related",
    description:
      "Given an article, find related articles through passage overlap, resource associations, or shared ACAI entities. Returns references, not full content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        resource_code: { type: "string", description: "The resource repository name." },
        language: { type: "string", description: "Language code." },
        content_id: { type: "string", description: "The article content ID." },
      },
      required: ["resource_code", "language", "content_id"],
    },
  },
];

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export async function handleList(
  args: Record<string, unknown>,
  env: Env,
) {
  const index = await getOrBuildIndex(env);
  let resources = index.registry;

  if (args.type) {
    const t = String(args.type).toLowerCase();
    resources = resources.filter(
      (r) => r.aquifer_type.toLowerCase() === t || r.resource_type.toLowerCase().includes(t),
    );
  }
  if (args.language) {
    const lang = String(args.language).toLowerCase();
    resources = resources.filter(
      (r) => r.language === lang || r.localizations.includes(lang),
    );
  }

  if (resources.length === 0) return textResult("No resources found matching the given filters.");

  const lines = resources.map(
    (r) =>
      `- **${r.title}** (${r.resource_code})\n  Type: ${r.resource_type} | Order: ${r.order} | Articles: ${r.article_count} | Language: ${r.language} | Localizations: ${r.localizations.join(", ") || "none"}`,
  );

  return textResult(
    `Found ${resources.length} resource(s):\n\n${lines.join("\n\n")}`,
  );
}

export async function handleSearch(
  args: Record<string, unknown>,
  env: Env,
) {
  const query = String(args.query ?? "").trim();
  if (!query) return textResult("Please provide a search query.");

  const index = await getOrBuildIndex(env);

  const bbcccvvv = parseReference(query);
  if (bbcccvvv) {
    return searchByPassage(bbcccvvv, index);
  }

  if (query.includes(":") && /^[a-z]+:/i.test(query)) {
    return searchByEntity(query, index, env);
  }

  return searchByTitle(query, index);
}

function searchByPassage(ref: string, index: NavigabilityIndex) {
  const matches: ArticleRef[] = [];

  for (const [range, refs] of index.passage) {
    if (rangesOverlap(ref, range)) {
      matches.push(...refs);
    }
  }

  if (matches.length === 0) {
    return textResult(`No articles found for passage ${rangeToReadable(ref)}.`);
  }

  const deduped = deduplicateRefs(matches);
  const lines = deduped.map(formatArticleRef);

  return textResult(
    `Found ${deduped.length} article(s) covering ${rangeToReadable(ref)}:\n\n${lines.join("\n\n")}`,
  );
}

async function searchByEntity(entityQuery: string, index: NavigabilityIndex, env: Env) {
  const matches: ArticleRef[] = [];
  const normalized = entityQuery.toLowerCase();

  for (const [entityId, refs] of index.entity) {
    if (entityId.toLowerCase() === normalized) {
      matches.push(...refs);
    }
  }

  if (matches.length === 0) {
    const bootstrapped = await bootstrapEntityMatches(normalized, index, env);
    matches.push(...bootstrapped);
  }

  if (matches.length === 0) {
    return textResult(`No articles found for entity "${entityQuery}".`);
  }

  const deduped = deduplicateRefs(matches);
  const lines = deduped.map(formatArticleRef);

  return textResult(
    `Found ${deduped.length} article(s) referencing ${entityQuery}:\n\n${lines.join("\n\n")}`,
  );
}

function searchByTitle(query: string, index: NavigabilityIndex) {
  const terms = query.toLowerCase().split(/\s+/);
  const matches: ArticleRef[] = [];

  for (const ref of index.title) {
    const title = ref.title.toLowerCase();
    if (terms.every((t) => title.includes(t))) {
      matches.push(ref);
    }
  }

  if (matches.length === 0) {
    return textResult(`No articles found matching "${query}".`);
  }

  const deduped = deduplicateRefs(matches);
  const lines = deduped.map(formatArticleRef);

  return textResult(
    `Found ${deduped.length} article(s) matching "${query}":\n\n${lines.join("\n\n")}`,
  );
}

export async function handleGet(
  args: Record<string, unknown>,
  env: Env,
) {
  const resourceCode = String(args.resource_code ?? "");
  const language = String(args.language ?? "");
  const contentId = String(args.content_id ?? "");

  if (!resourceCode || !language || !contentId) {
    return textResult("Missing required fields: resource_code, language, and content_id are all required.");
  }

  const index = await getOrBuildIndex(env);
  const entry = index.registry.find((r) => r.resource_code === resourceCode);
  if (!entry) {
    return textResult(`Resource "${resourceCode}" not found in the registry.`);
  }

  const article = await findArticle(resourceCode, language, contentId, entry, env);
  if (!article) {
    return textResult(
      `Article ${contentId} not found in ${resourceCode}/${language}. Verify the content_id is correct.`,
    );
  }

  return textResult(formatArticleContent(article, entry));
}

export async function handleRelated(
  args: Record<string, unknown>,
  env: Env,
) {
  const resourceCode = String(args.resource_code ?? "");
  const language = String(args.language ?? "");
  const contentId = String(args.content_id ?? "");

  if (!resourceCode || !language || !contentId) {
    return textResult("Missing required fields: resource_code, language, and content_id are all required.");
  }

  const index = await getOrBuildIndex(env);
  const entry = index.registry.find((r) => r.resource_code === resourceCode);
  if (!entry) return textResult(`Resource "${resourceCode}" not found.`);

  const article = await findArticle(resourceCode, language, contentId, entry, env);
  if (!article) return textResult(`Article ${contentId} not found.`);

  const related: Array<{ type: string; refs: ArticleRef[] }> = [];

  if (article.associations.passage?.length) {
    const passageRefs: ArticleRef[] = [];
    for (const assoc of article.associations.passage) {
      const range = `${assoc.start_ref}-${assoc.end_ref}`;
      for (const [indexRange, refs] of index.passage) {
        if (rangesOverlap(range, indexRange)) {
          passageRefs.push(...refs.filter(
            (r) => !(r.resource_code === resourceCode && r.content_id === contentId),
          ));
        }
      }
    }
    if (passageRefs.length) {
      related.push({ type: "Passage overlap", refs: deduplicateRefs(passageRefs) });
    }
  }

  if (article.associations.resource?.length) {
    const resourceRefs: ArticleRef[] = article.associations.resource.map((a) => ({
      resource_code: a.resource_code,
      language: a.language,
      content_id: String(a.content_id),
      title: a.label,
      resource_type: a.resource_code,
    }));
    related.push({ type: "Resource links", refs: resourceRefs });
  }

  if (article.associations.acai?.length) {
    const entityRefs: ArticleRef[] = [];
    for (const acai of article.associations.acai) {
      const refs = index.entity.get(String(acai.id).toLowerCase());
      if (refs) {
        entityRefs.push(...refs.filter(
          (r) => !(r.resource_code === resourceCode && r.language === language && r.content_id === contentId),
        ));
      }
    }
    if (entityRefs.length) {
      related.push({ type: "Shared ACAI entities", refs: deduplicateRefs(entityRefs) });
    }
  }

  if (related.length === 0) {
    return textResult(`No related articles found for ${resourceCode}/${contentId}.`);
  }

  const sections = related.map(
    (r) =>
      `### ${r.type} (${r.refs.length})\n\n${r.refs.map(formatArticleRef).join("\n\n")}`,
  );

  return textResult(
    `Related articles for "${article.title}" (${resourceCode}/${contentId}):\n\n${sections.join("\n\n")}`,
  );
}

async function findArticle(
  resourceCode: string,
  language: string,
  contentId: string,
  entry: ResourceEntry,
  env: Env,
): Promise<ArticleContent | null> {
  const indexReference = await resolveIndexReference(resourceCode, language, contentId, env);
  const metadataFiles = await listContentFiles(resourceCode, language, entry.order, env);
  const cachedFile = await env.AQUIFER_CACHE.get(`article-file:v1:${resourceCode}:${language}:${contentId}`);

  const candidateFiles: string[] = [];
  if (cachedFile) candidateFiles.push(cachedFile);
  if (entry.order === "canonical" && indexReference && isValidIndexReference(indexReference)) {
    candidateFiles.push(`${indexReference.slice(0, 2)}.content.json`);
  }
  candidateFiles.push(...metadataFiles);

  const uniqueFiles = Array.from(new Set(candidateFiles));
  for (const file of uniqueFiles) {
    if (!file) continue;
    const articles = await fetchContentFile(resourceCode, language, file, env);
    if (!articles) continue;

    const found = articles.find((a) => String(a.content_id) === contentId) ?? null;
    if (found) {
      await env.AQUIFER_CACHE.put(`article-file:v1:${resourceCode}:${language}:${contentId}`, file, {
        expirationTtl: 86400,
      });
      const index = await getOrBuildIndex(env);
      ingestArticleEntities(index, entry, found);
      return found;
    }
  }

  return null;
}

async function fetchContentFile(
  resourceCode: string,
  language: string,
  file: string,
  env: Env,
): Promise<ArticleContent[] | null> {
  const url = contentUrl(env.AQUIFER_ORG, resourceCode, language, file);
  const cacheKey = `content:${resourceCode}:${language}:${file}`;
  return fetchJson<ArticleContent[]>(url, env, cacheKey);
}

async function listContentFiles(
  resourceCode: string,
  language: string,
  order: string,
  env: Env,
): Promise<string[]> {
  const metadata = await getResourceMetadata(resourceCode, language, env);
  const ingredientKeys = Object.keys(metadata?.scripture_burrito?.ingredients ?? {});
  const files = ingredientKeys
    .filter((k) => k.startsWith("json/") && k.endsWith(".content.json"))
    .map((k) => k.replace(/^json\//, ""))
    .sort();

  if (files.length > 0) return files;
  if (order === "canonical") {
    return Array.from({ length: 66 }, (_, i) => `${String(i + 1).padStart(2, "0")}.content.json`);
  }
  return Array.from({ length: 120 }, (_, i) => `${String(i + 1).padStart(6, "0")}.content.json`);
}

async function getResourceMetadata(
  resourceCode: string,
  language: string,
  env: Env,
): Promise<ResourceMetadata | null> {
  const url = metadataUrl(env.AQUIFER_ORG, resourceCode, language);
  const cacheKey = `metadata:${resourceCode}:${language}`;
  return fetchJson<ResourceMetadata>(url, env, cacheKey);
}

async function resolveIndexReference(
  resourceCode: string,
  language: string,
  contentId: string,
  env: Env,
): Promise<string | null> {
  const metadata = await getResourceMetadata(resourceCode, language, env);
  const direct = metadata?.article_metadata?.[contentId]?.index_reference;
  if (direct && isValidIndexReference(direct)) return direct;

  if (language !== "eng") {
    const englishMetadata = await getResourceMetadata(resourceCode, "eng", env);
    if (englishMetadata?.article_metadata) {
      for (const article of Object.values(englishMetadata.article_metadata)) {
        const localizedContentId = article.localizations?.[language]?.content_id;
        if (localizedContentId && String(localizedContentId) === contentId && isValidIndexReference(article.index_reference)) {
          return article.index_reference;
        }
      }
    }
  }

  return null;
}

function ingestArticleEntities(index: NavigabilityIndex, entry: ResourceEntry, article: ArticleContent): void {
  if (!article.associations?.acai?.length) return;
  const articleRef: ArticleRef = {
    resource_code: entry.resource_code,
    language: article.language || entry.language,
    content_id: String(article.content_id),
    title: article.title || `Article ${article.content_id}`,
    resource_type: entry.resource_type,
    index_reference: article.index_reference,
  };

  for (const acai of article.associations.acai) {
    const entityId = String(acai.id || "").toLowerCase();
    if (!entityId) continue;
    const existing = index.entity.get(entityId) ?? [];
    existing.push(articleRef);
    index.entity.set(entityId, deduplicateRefs(existing));
  }
}

async function bootstrapEntityMatches(
  normalizedEntityId: string,
  index: NavigabilityIndex,
  env: Env,
): Promise<ArticleRef[]> {
  const cacheKey = `entity-search:v1:${normalizedEntityId}`;
  const cached = await env.AQUIFER_CACHE.get(cacheKey, "json") as ArticleRef[] | null;
  if (cached?.length) {
    index.entity.set(normalizedEntityId, cached);
    return cached;
  }

  const matches: ArticleRef[] = [];
  for (const entry of index.registry) {
    const files = await listContentFiles(entry.resource_code, entry.language, entry.order, env);
    for (const file of files) {
      const articles = await fetchContentFile(entry.resource_code, entry.language, file, env);
      if (!articles?.length) continue;

      for (const article of articles) {
        const acaiAssociations = article.associations?.acai ?? [];
        if (!acaiAssociations.some((a) => String(a.id || "").toLowerCase() === normalizedEntityId)) {
          continue;
        }
        matches.push({
          resource_code: entry.resource_code,
          language: article.language || entry.language,
          content_id: String(article.content_id),
          title: article.title || `Article ${article.content_id}`,
          resource_type: entry.resource_type,
          index_reference: article.index_reference,
        });
      }
    }
  }

  const deduped = deduplicateRefs(matches);
  if (deduped.length > 0) {
    index.entity.set(normalizedEntityId, deduped);
    await env.AQUIFER_CACHE.put(cacheKey, JSON.stringify(deduped), { expirationTtl: 86400 });
  }
  return deduped;
}

function formatArticleRef(ref: ArticleRef): string {
  const passage = ref.index_reference ? ` | ${rangeToReadable(ref.index_reference)}` : "";
  return `- **${ref.title}**\n  ${ref.resource_type} | ${ref.resource_code}/${ref.language}/${ref.content_id}${passage}`;
}

function formatArticleContent(article: ArticleContent, entry: { title: string; resource_code: string }): string {
  const parts: string[] = [
    `# ${article.title}`,
    `**Source**: ${entry.title} (${entry.resource_code}/${article.language}/${article.content_id})`,
    `**Passage**: ${article.associations.passage?.map((p) => `${p.start_ref_usfm}-${p.end_ref_usfm}`).join(", ") ?? "none"}`,
    `**Version**: ${article.version} | **Review**: ${article.review_level}`,
    "",
    article.content,
  ];

  if (article.associations.resource?.length) {
    parts.push("", "## Resource Links");
    for (const r of article.associations.resource) {
      parts.push(`- ${r.label} (${r.resource_code}/${r.language}/${r.content_id})`);
    }
  }

  if (article.associations.acai?.length) {
    parts.push("", "## ACAI Entities");
    for (const a of article.associations.acai) {
      parts.push(`- ${a.preferred_label} (${a.id}, ${a.type}, confidence: ${a.confidence})`);
    }
  }

  return parts.join("\n");
}

function deduplicateRefs(refs: ArticleRef[]): ArticleRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.resource_code}:${r.language}:${r.content_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
