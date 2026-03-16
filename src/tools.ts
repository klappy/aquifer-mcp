import type { Env, ArticleRef, ArticleContent, NavigabilityIndex } from "./types.js";
import { parseReference, rangesOverlap, rangeToReadable, bookNumToFileNum } from "./references.js";
import { contentUrl, fetchJson } from "./github.js";
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
    return searchByEntity(query, index);
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

function searchByEntity(entityQuery: string, index: NavigabilityIndex) {
  const matches: ArticleRef[] = [];
  const normalized = entityQuery.toLowerCase();

  for (const [entityId, refs] of index.entity) {
    if (entityId.toLowerCase() === normalized) {
      matches.push(...refs);
    }
  }

  if (matches.length === 0) {
    return textResult(
      `No articles found for entity "${entityQuery}". Note: the entity index is built incrementally from fetched content. Try searching by passage first, then use related to find entity connections.`,
    );
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

  for (const refs of index.passage.values()) {
    for (const ref of refs) {
      const title = ref.title.toLowerCase();
      if (terms.every((t) => title.includes(t))) {
        matches.push(ref);
      }
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
      const refs = index.entity.get(acai.id);
      if (refs) {
        entityRefs.push(...refs.filter(
          (r) => !(r.resource_code === resourceCode && r.content_id === contentId),
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
  entry: { order: string },
  env: Env,
): Promise<ArticleContent | null> {
  const index = await getOrBuildIndex(env);

  let targetRef: ArticleRef | undefined;
  for (const refs of index.passage.values()) {
    const found = refs.find(
      (r) => r.resource_code === resourceCode && r.content_id === contentId,
    );
    if (found) { targetRef = found; break; }
  }

  let file: string;
  if (entry.order === "canonical" && targetRef?.index_reference) {
    const bookNum = targetRef.index_reference.slice(0, 2);
    file = `${bookNum}.content.json`;
  } else {
    file = await guessContentFile(resourceCode, language, contentId, env);
  }

  const articles = await fetchContentFile(resourceCode, language, file, env);
  if (!articles) return null;

  return articles.find((a) => String(a.content_id) === contentId) ?? null;
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

async function guessContentFile(
  resourceCode: string,
  language: string,
  contentId: string,
  env: Env,
): Promise<string> {
  for (let i = 1; i <= 10; i++) {
    const file = `${String(i).padStart(6, "0")}.content.json`;
    const articles = await fetchContentFile(resourceCode, language, file, env);
    if (articles?.some((a) => String(a.content_id) === contentId)) return file;
  }
  return "000001.content.json";
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
    const key = `${r.resource_code}:${r.content_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
