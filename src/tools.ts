import type { Env, ArticleRef, ArticleContent, NavigabilityIndex, ResourceEntry, ResourceMetadata } from "./types.js";
import { parseReference, rangesOverlap, rangeToReadable, isValidIndexReference } from "./references.js";
import { contentUrl, metadataUrl, fetchJson, GC_TTL } from "./github.js";
import { getOrBuildIndex } from "./registry.js";

const README_RAW_URL = "https://raw.githubusercontent.com/klappy/aquifer-mcp/main/README.md";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

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
      headers: { "User-Agent": "aquifer-mcp/0.5" },
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

  const sha = index.repo_shas.get(resourceCode) ?? "";
  if (!sha) return textResult(`No SHA available for resource "${resourceCode}".`);
  const article = await findArticle(resourceCode, language, contentId, entry, env, sha, index);
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

  const sha = index.repo_shas.get(resourceCode) ?? "";
  if (!sha) return textResult(`No SHA available for resource "${resourceCode}".`);
  const article = await findArticle(resourceCode, language, contentId, entry, env, sha, index);
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
  sha: string,
  index: NavigabilityIndex,
): Promise<ArticleContent | null> {
  const indexReference = await resolveIndexReference(resourceCode, language, contentId, env, sha);
  const metadataFiles = await listContentFiles(resourceCode, language, entry.order, env, sha);
  const articleFileKey = `${sha}:article-file:v2:${resourceCode}:${language}:${contentId}`;
  const cachedFile = await env.AQUIFER_CACHE.get(articleFileKey);

  const candidateFiles: string[] = [];
  if (cachedFile) candidateFiles.push(cachedFile);
  if (entry.order === "canonical" && indexReference && isValidIndexReference(indexReference)) {
    candidateFiles.push(`${indexReference.slice(0, 2)}.content.json`);
  }
  candidateFiles.push(...metadataFiles);

  const uniqueFiles = Array.from(new Set(candidateFiles));
  for (const file of uniqueFiles) {
    if (!file) continue;
    const articles = await fetchContentFile(resourceCode, language, file, env, sha);
    if (!articles) continue;

    const found = articles.find((a) => String(a.content_id) === contentId) ?? null;
    if (found) {
      await env.AQUIFER_CACHE.put(articleFileKey, file, {
        expirationTtl: GC_TTL,
      });
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
  sha: string,
): Promise<ArticleContent[] | null> {
  const url = contentUrl(env.AQUIFER_ORG, resourceCode, language, file);
  const cacheKey = `content:${resourceCode}:${language}:${file}`;
  return fetchJson<ArticleContent[]>(url, env, cacheKey, sha);
}

async function listContentFiles(
  resourceCode: string,
  language: string,
  order: string,
  env: Env,
  sha: string,
): Promise<string[]> {
  const metadata = await getResourceMetadata(resourceCode, language, env, sha);
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
  sha: string,
): Promise<ResourceMetadata | null> {
  const url = metadataUrl(env.AQUIFER_ORG, resourceCode, language);
  const cacheKey = `metadata:${resourceCode}:${language}`;
  return fetchJson<ResourceMetadata>(url, env, cacheKey, sha);
}

async function resolveIndexReference(
  resourceCode: string,
  language: string,
  contentId: string,
  env: Env,
  sha: string,
): Promise<string | null> {
  const metadata = await getResourceMetadata(resourceCode, language, env, sha);
  const direct = metadata?.article_metadata?.[contentId]?.index_reference;
  if (direct && isValidIndexReference(direct)) return direct;

  if (language !== "eng") {
    const englishMetadata = await getResourceMetadata(resourceCode, "eng", env, sha);
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
  const cacheKey = `${index.composite_sha}:entity-search:v3:${normalizedEntityId}`;
  const cached = await env.AQUIFER_CACHE.get(cacheKey, "json") as ArticleRef[] | null;
  if (cached?.length) {
    index.entity.set(normalizedEntityId, cached);
    return cached;
  }

  const matches: ArticleRef[] = [];
  for (const entry of index.registry) {
    const repoSha = index.repo_shas.get(entry.resource_code);
    if (!repoSha) continue;
    const files = await listContentFiles(entry.resource_code, entry.language, entry.order, env, repoSha);
    for (const file of files) {
      const articles = await fetchContentFile(entry.resource_code, entry.language, file, env, repoSha);
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
    await env.AQUIFER_CACHE.put(cacheKey, JSON.stringify(deduped), { expirationTtl: GC_TTL });
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

// --- Browse tool ---

interface BrowseCatalogEntry {
  content_id: string;
  title: string;
  media_type: string;
  image_url: string | null;
  passages: Array<{ start_usfm: string; end_usfm: string }>;
}

function extractImageUrl(html: string): string | null {
  const match = html.match(/src=['"]?(https:\/\/cdn\.aquifer\.bible\/[^'">\s]+)/);
  return match?.[1] ?? null;
}

async function buildCatalog(
  resourceCode: string,
  language: string,
  entry: ResourceEntry,
  env: Env,
  sha: string,
): Promise<BrowseCatalogEntry[]> {
  const cacheKey = `${sha}:browse:v2:${resourceCode}:${language}`;
  const cached = await env.AQUIFER_CACHE.get(cacheKey, "json") as BrowseCatalogEntry[] | null;
  if (cached) return cached;

  const files = await listContentFiles(resourceCode, language, entry.order, env, sha);
  const results = await Promise.allSettled(
    files.map((file) => fetchContentFile(resourceCode, language, file, env, sha)),
  );

  const catalog: BrowseCatalogEntry[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    for (const article of result.value) {
      catalog.push({
        content_id: String(article.content_id),
        title: article.title || `Article ${article.content_id}`,
        media_type: article.media_type || "",
        image_url: extractImageUrl(article.content || ""),
        passages: (article.associations?.passage ?? []).map((p) => ({
          start_usfm: p.start_ref_usfm,
          end_usfm: p.end_ref_usfm,
        })),
      });
    }
  }

  if (catalog.length > 0) {
    await env.AQUIFER_CACHE.put(cacheKey, JSON.stringify(catalog), { expirationTtl: GC_TTL });
  }
  return catalog;
}

export async function handleBrowse(
  args: Record<string, unknown>,
  env: Env,
) {
  const resourceCode = String(args.resource_code ?? "").trim();
  if (!resourceCode) return textResult("Missing required field: resource_code.");

  const language = String(args.language ?? "eng").trim();
  const page = Math.max(1, Number(args.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(args.page_size) || 50));

  const index = await getOrBuildIndex(env);
  const entry = index.registry.find((r) => r.resource_code === resourceCode);
  if (!entry) return textResult(`Resource "${resourceCode}" not found in the registry.`);

  const sha = index.repo_shas.get(resourceCode) ?? "";
  if (!sha) return textResult(`No SHA available for resource "${resourceCode}".`);
  const catalog = await buildCatalog(resourceCode, language, entry, env, sha);
  if (catalog.length === 0) return textResult(`No articles found in ${resourceCode}/${language}.`);

  const totalPages = Math.ceil(catalog.length / pageSize);
  const start = (page - 1) * pageSize;
  const slice = catalog.slice(start, start + pageSize);

  if (slice.length === 0) {
    return textResult(`Page ${page} is out of range. ${catalog.length} articles, ${totalPages} pages.`);
  }

  const lines = slice.map((a) => {
    const parts = [`- **${a.title}**`];
    const meta = [`${resourceCode}/${language}/${a.content_id}`];
    if (a.passages.length) {
      meta.push(`Passages: ${a.passages.map((p) => `${p.start_usfm}\u2013${p.end_usfm}`).join(", ")}`);
    }
    parts.push(`  ${meta.join(" | ")}`);
    if (a.image_url) parts.push(`  Image: ${a.image_url}`);
    return parts.join("\n");
  });

  const header = `**${entry.title}** (${resourceCode}/${language}) \u2014 ${catalog.length} articles total, page ${page}/${totalPages}`;
  const footer = page < totalPages ? `\n\n*Page ${page} of ${totalPages}. Use page=${page + 1} to see more.*` : "";

  return textResult(`${header}\n\n${lines.join("\n\n")}${footer}`);
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
