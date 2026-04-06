import type { Env, ArticleRef, ArticleContent, NavigabilityIndex, ResourceEntry, ResourceMetadata } from "./types.js";
import { parseReference, rangesOverlap, rangeToReadable, isValidIndexReference, bbcccvvvToReadable } from "./references.js";
import { contentUrl, metadataUrl, fetchJson, GC_TTL, fetchRepoSha } from "./github.js";
import { getOrBuildIndex, fanOutPassageSearch, fanOutTitleSearch, loadArticleLookup, type ArticleLookupEntry } from "./registry.js";
import { getPublicTelemetrySnapshot } from "./telemetry.js";
import { AquiferStorage, contentKey, metadataKey, catalogKey, entityKey } from "./storage.js";
import type { RequestTracer } from "./tracing.js";
import { VERSION } from "./version.js";

const README_RAW_URL = "https://raw.githubusercontent.com/klappy/aquifer-mcp/main/README.md";

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

const TELEMETRY_POLICY_BASE = [
  "# Aquifer Telemetry Policy (v1)",
  "",
  "Track system behavior with high fidelity while protecting user anonymity by default.",
  "",
  "## Currently Tracked By This Server (Public Aggregates)",
  "- JSON-RPC method counts (`initialize`, `tools/list`, `tools/call`, etc.).",
  "- Total MCP request count and total tool-call count.",
  "- Automatic tracking for all `tools/call` usage through the server transport path.",
  "- Tool-call counts by tool name.",
  "- Tool-call counts by consumer label.",
  "- Weighted consumer scores for leaderboard ranking (verified clients receive 10x score per tool call).",
  "- Consumer-label source counts (`x-aquifer-client`, `initialize.clientInfo.name`, `user-agent`, `unknown`).",
  "- Consumer verification class counts (`verified`, `unverified`).",
  "- Self-report completeness scoring and transparency badges for optional metadata disclosure.",
  "- Resource access counts by resource_code (structural identifier, not content).",
  "- Language access counts by language code.",
  "- Article access counts by compound key (resource_code:language:content_id).",
  "- Search type breakdown (passage, entity, title) classified from query pattern, not raw query text.",
  "- Passage hierarchy rollup counters (testament, book, chapter, verse) for passage searches.",
  "- Last article accessed (compound key + tool + timestamp).",
  "- Last telemetry update timestamp.",
  "",
  "## Allowed Optional Client Sharing (Not Required Server Collection)",
  "- Coarse status classes, latency buckets, cache outcomes, and error classes.",
  "- Client app/version and integration surface (for example `mcp-client` or `aquifer-window`).",
  "- Pseudonymous session/install identifiers only when needed for continuity metrics.",
  "",
  "## Required Exclusions",
  "- No raw prompts, raw queries, article content, or model responses.",
  "- No user identity fields (name, email, account IDs).",
  "- No IP addresses, browser fingerprinting, or device fingerprinting.",
  "",
  "## How To Share",
  "1. Send event metadata only, never content payloads.",
  "2. If identifiers are needed, hash locally using a client secret or rotating salt before sending.",
  "3. Batch and retry telemetry out-of-band so user-facing flows stay fast.",
  "4. Treat opt-in debug payload capture as temporary and time-limited.",
  "",
  "## Recommended Event Families",
  "- `mcp_tool_call`: tool usage, latency, success/failure.",
  "- `mcp_transport`: initialize/tools/list/tools/call transport health.",
  "- `window_action`: UI interaction milestones in Aquifer Window.",
  "- `system_health`: index build timing, upstream fetch failures, cache behavior.",
  "",
  "## Integrity Rule",
  "Do not add obfuscation outside safety requirements. Redact only what is needed to protect people, not to blur usage reality.",
  "",
  "## Leaderboard Integrity Note",
  "Consumer labels are transparent self-declarations for openness and incentive design; they are not identity proof unless explicitly verified by server-side allowlist.",
  "Verified clients score 10x per tool call on the weighted leaderboard.",
  "Self-reported metadata fields are honor-system by default; richer disclosure earns transparency ranking and badges.",
].join("\n");

const TELEMETRY_POLICY_BY_SURFACE: Record<string, string> = {
  "mcp-client": [
    "## Surface Guidance: mcp-client",
    "- Include: `tool_name`, `status`, `latency_ms`, `client_name`, `client_version`, `server_url_host`.",
    "- Optional: `session_id_hash` for repeat usage analysis.",
    "- Exclude: tool arguments and any model prompt/response body.",
  ].join("\n"),
  "aquifer-window": [
    "## Surface Guidance: aquifer-window",
    "- Include: `action`, `status`, `latency_ms`, `route`, `app_version`.",
    "- Optional: `install_id_hash` or `session_id_hash` for continuity metrics.",
    "- Exclude: search query text, opened article HTML, and user-entered free text.",
  ].join("\n"),
};

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

export async function handleTelemetryPolicy(
  args: Record<string, unknown>,
  _env: Env,
) {
  const requestedSurface = String(args.surface ?? "").trim().toLowerCase();
  const surfaceGuidance = requestedSurface ? TELEMETRY_POLICY_BY_SURFACE[requestedSurface] : "";

  if (requestedSurface && !surfaceGuidance) {
    const supported = Object.keys(TELEMETRY_POLICY_BY_SURFACE).join(", ");
    return textResult(
      `${TELEMETRY_POLICY_BASE}\n\nUnknown surface "${requestedSurface}". Supported values: ${supported}.`,
    );
  }

  return textResult(
    surfaceGuidance
      ? `${TELEMETRY_POLICY_BASE}\n\n${surfaceGuidance}`
      : TELEMETRY_POLICY_BASE,
  );
}

export async function handleTelemetryPublic(
  args: Record<string, unknown>,
  env: Env,
) {
  const requestedLimit = Number(args.limit ?? 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 10));
  const snapshot = await getPublicTelemetrySnapshot(env, limit);

  const rankLines = (items: typeof snapshot.leaderboards.consumers, empty: string) =>
    items.length
      ? items.map((item, idx) => `${idx + 1}. ${item.name} — ${item.calls} calls`).join("\n")
      : empty;

  const consumerLines = rankLines(snapshot.leaderboards.consumers, "_No consumer calls recorded yet._");
  const toolLines = rankLines(snapshot.leaderboards.tools, "_No tool calls recorded yet._");
  const resourceLines = rankLines(snapshot.leaderboards.resources, "_No resource access recorded yet._");
  const languageLines = rankLines(snapshot.leaderboards.languages, "_No language access recorded yet._");
  const articleLines = snapshot.leaderboards.articles.length
    ? snapshot.leaderboards.articles.map((item, idx) => `${idx + 1}. ${item.name} — ${item.calls} accesses`).join("\n")
    : "_No article access recorded yet._";
  const searchTypeLines = rankLines(snapshot.search_type_counts, "_No search type counts recorded yet._");
  const passageTestamentLines = rankLines(snapshot.passage_counts.testaments, "_No passage testament counts yet._");
  const passageBookLines = rankLines(snapshot.passage_counts.books, "_No passage book counts yet._");
  const passageChapterLines = rankLines(snapshot.passage_counts.chapters, "_No passage chapter counts yet._");
  const passageVerseLines = rankLines(snapshot.passage_counts.verses, "_No passage verse counts yet._");
  const weightedConsumerLines = snapshot.leaderboards.consumers_weighted.length
    ? snapshot.leaderboards.consumers_weighted.map((item, idx) => `${idx + 1}. ${item.name} — ${item.calls} weighted points`).join("\n")
    : "_No weighted consumer scores recorded yet._";
  const transparencyLines = snapshot.leaderboards.transparency.length
    ? snapshot.leaderboards.transparency
      .map(
        (item, idx) =>
          `${idx + 1}. ${item.name} — ${item.completeness_pct}% (${item.details_shared}/${item.details_possible}) | ${item.badge}`,
      )
      .join("\n")
    : "_No transparency scores recorded yet._";

  const tracked = snapshot.tracked_fields.map((field) => `- ${field}`).join("\n");
  const trackedNotes = snapshot.tracked_field_notes.map((field) => `- ${field}`).join("\n");
  const excluded = snapshot.excluded_fields.map((field) => `- ${field}`).join("\n");
  const methodLines = rankLines(snapshot.method_counts, "_No method counts recorded yet._");
  const sourceLines = rankLines(snapshot.consumer_label_sources, "_No label source counts recorded yet._");
  const verificationLines = rankLines(snapshot.consumer_verification_counts, "_No verification counts recorded yet._");
  const selfReportFieldLines = rankLines(snapshot.self_report_field_counts, "_No self-report field counts recorded yet._");

  const lastArticle = snapshot.last_article
    ? `${snapshot.last_article.resource_code}/${snapshot.last_article.language}/${snapshot.last_article.content_id} (via ${snapshot.last_article.tool} at ${snapshot.last_article.accessed_at})`
    : "none yet";

  return textResult(
    [
      `# Public Telemetry Snapshot (${snapshot.schema_version})`,
      "",
      "## Totals",
      `- MCP requests: ${snapshot.totals.mcp_requests}`,
      `- Tool calls: ${snapshot.totals.tool_calls}`,
      "",
      "## Resource Leaderboard",
      resourceLines,
      "",
      "## Language Leaderboard",
      languageLines,
      "",
      "## Article Leaderboard",
      articleLines,
      "",
      "## Search Type Breakdown",
      searchTypeLines,
      "",
      "## Passage Hierarchy (from passage searches)",
      "### By Testament",
      passageTestamentLines,
      "### By Book",
      passageBookLines,
      "### By Chapter",
      passageChapterLines,
      "### By Verse",
      passageVerseLines,
      "",
      "## Last Article Accessed",
      `- ${lastArticle}`,
      "",
      "## Consumer Leaderboard",
      consumerLines,
      "",
      "## Tool Leaderboard",
      toolLines,
      "",
      "## Weighted Consumer Leaderboard (Verified 10x)",
      weightedConsumerLines,
      "",
      "## Transparency Leaderboard (Self-Report Completeness)",
      transparencyLines,
      "",
      "## Method Counts",
      methodLines,
      "",
      "## Consumer Label Sources",
      sourceLines,
      "",
      "## Consumer Verification Counts",
      verificationLines,
      "",
      "## Self-Report Field Counts",
      selfReportFieldLines,
      "",
      "## Tracked Fields",
      tracked,
      "",
      "## Tracking Notes",
      trackedNotes,
      "",
      "## Excluded Fields",
      excluded,
      "",
      `- Last recorded at: ${snapshot.last_recorded_at ?? "none yet"}`,
      "",
      "Telemetry is intentionally public at the aggregate level to support transparent usage reporting and leaderboard gamification.",
    ].join("\n"),
  );
}

export async function handleList(
  args: Record<string, unknown>,
  env: Env,
  storage: AquiferStorage,
  ctx?: ExecutionContext,
  tracer?: RequestTracer,
) {
  const index = await getOrBuildIndex(env, storage, ctx, tracer);

  let resources = index.registry;

  if (args.type) {
    const t = String(args.type).toLowerCase();
    // Exact match on aquifer_type first; fall back to substring on resource_type
    const exact = resources.filter((r) => r.aquifer_type.toLowerCase() === t);
    resources = exact.length > 0
      ? exact
      : resources.filter((r) => r.resource_type.toLowerCase().includes(t));
  }
  if (args.language) {
    const lang = String(args.language).toLowerCase();
    resources = resources.filter(
      (r) => r.language === lang || r.localizations.includes(lang),
    );
  }

  if (resources.length === 0) return textResult("No resources found matching the given filters.");

  const lines = resources.map((r) => {
    const capabilities: string[] = ["search", "get", "related", "browse"];
    if (
      r.resource_type.toLowerCase().includes("bible") ||
      r.aquifer_type.toLowerCase() === "bible"
    ) {
      capabilities.unshift("scripture");
    }
    return `- **${r.title}** (${r.resource_code})\n  Type: ${r.resource_type} | Order: ${r.order} | Articles: ${r.article_count} | Language: ${r.language} | Localizations: ${r.localizations.join(", ") || "none"} | Tools: ${capabilities.join(", ")}`;
  });

  return textResult(
    `Found ${resources.length} resource(s):\n\n${lines.join("\n\n")}`,
  );
}

export async function handleSearch(
  args: Record<string, unknown>,
  env: Env,
  storage: AquiferStorage,
  ctx?: ExecutionContext,
  tracer?: RequestTracer,
) {
  const query = String(args.query ?? "").trim();
  if (!query) return textResult("Please provide a search query.");

  const index = await getOrBuildIndex(env, storage, ctx, tracer);

  const bbcccvvv = parseReference(query);
  if (bbcccvvv) {
    return searchByPassage(bbcccvvv, index, storage, tracer);
  }

  if (query.includes(":") && /^[a-z]+:/i.test(query)) {
    return searchByEntity(query, index, env, storage, tracer);
  }

  return searchByTitle(query, index, storage, tracer);
}

async function searchByPassage(ref: string, index: NavigabilityIndex, storage: AquiferStorage, tracer?: RequestTracer) {
  const matches = await fanOutPassageSearch(ref, index, storage, tracer);

  if (matches.length === 0) {
    return textResult(`No articles found for passage ${rangeToReadable(ref)}.`);
  }

  const deduped = deduplicateRefs(matches);
  const lines = deduped.map(formatArticleRef);

  return textResult(
    `Found ${deduped.length} article(s) covering ${rangeToReadable(ref)}:\n\n${lines.join("\n\n")}`,
  );
}

async function searchByEntity(entityQuery: string, index: NavigabilityIndex, env: Env, storage: AquiferStorage, tracer?: RequestTracer) {
  const matches: ArticleRef[] = [];
  const normalized = entityQuery.toLowerCase();

  for (const [entityId, refs] of index.entity) {
    if (entityId.toLowerCase() === normalized) {
      matches.push(...refs);
    }
  }

  if (matches.length === 0) {
    const bootstrapped = await bootstrapEntityMatches(normalized, index, env, storage, tracer);
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

async function searchByTitle(query: string, index: NavigabilityIndex, storage: AquiferStorage, tracer?: RequestTracer) {
  const terms = query.toLowerCase().split(/\s+/);
  const matches = await fanOutTitleSearch(terms, index, storage, tracer);

  if (matches.length === 0) {
    const hint = terms.length === 1
      ? ` Tip: For comprehensive coverage, try the entity tool with ACAI IDs like "person:${query}" or "keyterm:${query}".`
      : "";
    return textResult(`No articles found matching "${query}".${hint}`);
  }

  const deduped = deduplicateRefs(matches);
  const lines = deduped.map(formatArticleRef);

  const hint = terms.length === 1
    ? `\n\nTip: For comprehensive coverage, try the entity tool with ACAI IDs like "person:${query}" or "keyterm:${query}".`
    : "";

  return textResult(
    `Found ${deduped.length} article(s) matching "${query}":\n\n${lines.join("\n\n")}${hint}`,
  );
}

export async function handleGet(
  args: Record<string, unknown>,
  env: Env,
  storage: AquiferStorage,
  ctx?: ExecutionContext,
  tracer?: RequestTracer,
) {
  const resourceCode = String(args.resource_code ?? "");
  const language = String(args.language ?? "");
  const contentId = String(args.content_id ?? "");

  if (!resourceCode || !language || !contentId) {
    return textResult("Missing required fields: resource_code, language, and content_id are all required.");
  }

  const index = await getOrBuildIndex(env, storage, ctx, tracer);
  const entry = index.registry.find((r) => r.resource_code === resourceCode);
  if (!entry) {
    return textResult(`Resource "${resourceCode}" not found in the registry.`);
  }

  const sha = index.repo_shas.get(resourceCode) ?? "";
  if (!sha) return textResult(`No SHA available for resource "${resourceCode}".`);
  const article = await findArticle(resourceCode, language, contentId, entry, env, storage, sha, index, tracer);
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
  storage: AquiferStorage,
  ctx?: ExecutionContext,
  tracer?: RequestTracer,
) {
  const resourceCode = String(args.resource_code ?? "");
  const language = String(args.language ?? "");
  const contentId = String(args.content_id ?? "");

  if (!resourceCode || !language || !contentId) {
    return textResult("Missing required fields: resource_code, language, and content_id are all required.");
  }

  const index = await getOrBuildIndex(env, storage, ctx, tracer);
  const entry = index.registry.find((r) => r.resource_code === resourceCode);
  if (!entry) return textResult(`Resource "${resourceCode}" not found.`);

  const sha = index.repo_shas.get(resourceCode) ?? "";
  if (!sha) return textResult(`No SHA available for resource "${resourceCode}".`);
  const article = await findArticle(resourceCode, language, contentId, entry, env, storage, sha, index, tracer);
  if (!article) return textResult(`Article ${contentId} not found.`);

  const related: Array<{ type: string; refs: ArticleRef[] }> = [];

  if (article.associations.passage?.length) {
    const passageRefs: ArticleRef[] = [];
    for (const assoc of article.associations.passage) {
      const range = `${assoc.start_ref}-${assoc.end_ref}`;
      const overlapping = await fanOutPassageSearch(range, index, storage, tracer);
      passageRefs.push(...overlapping.filter(
        (r) => !(r.resource_code === resourceCode && r.content_id === contentId),
      ));
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
  storage: AquiferStorage,
  sha: string,
  index: NavigabilityIndex,
  tracer?: RequestTracer,
): Promise<ArticleContent | null> {
  const findStart = performance.now();
  // --- Fast path: article lookup index (one R2 read, cached) ---
  const lookup = await loadArticleLookup(resourceCode, sha, storage, tracer);
  const location = lookup?.[contentId];
  if (location?.file) {
    const articles = await fetchContentFile(resourceCode, language, location.file, env, storage, sha, tracer);
    const found = articles?.find((a) => String(a.content_id) === contentId) ?? null;
    if (found) {
      tracer?.addSpan("find-article", Math.round(performance.now() - findStart), undefined, "lookup-hit");
      ingestArticleEntities(index, entry, found);
      return found;
    }
  }

  // --- Fallback: KV hint + index_reference derivation + metadata file list ---
  const articleFileKey = `${sha}:article-file:v2:${resourceCode}:${language}:${contentId}`;
  const cachedFile = await env.AQUIFER_CACHE.get(articleFileKey);
  const indexReference = await resolveIndexReference(resourceCode, language, contentId, env, storage, sha, tracer);

  const candidateFiles: string[] = [];
  if (cachedFile) candidateFiles.push(cachedFile);
  if (entry.order === "canonical" && indexReference && isValidIndexReference(indexReference)) {
    candidateFiles.push(`${indexReference.slice(0, 2)}.content.json`);
  }
  // For non-canonical with unknown file, scan metadata file list
  const metadataFiles = await listContentFiles(resourceCode, language, entry.order, env, storage, sha, tracer);
  candidateFiles.push(...metadataFiles);

  const uniqueFiles = Array.from(new Set(candidateFiles));
  for (const file of uniqueFiles) {
    if (!file) continue;
    // Skip files already tried via lookup
    if (location?.file === file) continue;
    const articles = await fetchContentFile(resourceCode, language, file, env, storage, sha, tracer);
    if (!articles) continue;

    const found = articles.find((a) => String(a.content_id) === contentId) ?? null;
    if (found) {
      await env.AQUIFER_CACHE.put(articleFileKey, file, { expirationTtl: GC_TTL });
      tracer?.addSpan("find-article", Math.round(performance.now() - findStart), undefined, `fallback:${file}`);
      ingestArticleEntities(index, entry, found);
      return found;
    }
  }

  tracer?.addSpan("find-article", Math.round(performance.now() - findStart), undefined, "miss");
  return null;
}

async function fetchContentFile(
  resourceCode: string,
  language: string,
  file: string,
  env: Env,
  storage: AquiferStorage,
  sha: string,
  tracer?: RequestTracer,
): Promise<ArticleContent[] | null> {
  const url = contentUrl(env.AQUIFER_ORG, resourceCode, language, file);
  const key = contentKey(resourceCode, sha, language, file);
  return fetchJson<ArticleContent[]>(url, storage, key, tracer);
}

async function listContentFiles(
  resourceCode: string,
  language: string,
  order: string,
  env: Env,
  storage: AquiferStorage,
  sha: string,
  tracer?: RequestTracer,
): Promise<string[]> {
  const metadata = await getResourceMetadata(resourceCode, language, env, storage, sha, tracer);
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
  storage: AquiferStorage,
  sha: string,
  tracer?: RequestTracer,
): Promise<ResourceMetadata | null> {
  const url = metadataUrl(env.AQUIFER_ORG, resourceCode, language);
  const key = metadataKey(resourceCode, sha, language);
  return fetchJson<ResourceMetadata>(url, storage, key, tracer);
}

async function resolveIndexReference(
  resourceCode: string,
  language: string,
  contentId: string,
  env: Env,
  storage: AquiferStorage,
  sha: string,
  tracer?: RequestTracer,
): Promise<string | null> {
  const metadata = await getResourceMetadata(resourceCode, language, env, storage, sha, tracer);
  const direct = metadata?.article_metadata?.[contentId]?.index_reference;
  if (direct && isValidIndexReference(direct)) return direct;

  if (language !== "eng") {
    const englishMetadata = await getResourceMetadata(resourceCode, "eng", env, storage, sha, tracer);
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
  storage: AquiferStorage,
  tracer?: RequestTracer,
): Promise<ArticleRef[]> {
  // Entity bootstrap cache stored in R2, keyed by composite SHA + entity ID
  const key = entityKey(index.composite_sha, normalizedEntityId);
  const { data: cached } = await storage.getJSON<ArticleRef[]>(key, tracer);
  if (cached?.length) {
    index.entity.set(normalizedEntityId, cached);
    return cached;
  }

  const matches: ArticleRef[] = [];
  const bootstrapStart = performance.now();

  // Parallel across resources
  const resourceResults = await Promise.allSettled(
    index.registry.map(async (entry) => {
      const repoSha = index.repo_shas.get(entry.resource_code);
      if (!repoSha) return [];
      const files = await listContentFiles(entry.resource_code, entry.language, entry.order, env, storage, repoSha, tracer);

      // Parallel across files within each resource
      const fileResults = await Promise.allSettled(
        files.map(async (file) => {
          const articles = await fetchContentFile(entry.resource_code, entry.language, file, env, storage, repoSha, tracer);
          if (!articles?.length) return [];
          const found: ArticleRef[] = [];
          for (const article of articles) {
            const acaiAssociations = article.associations?.acai ?? [];
            if (!acaiAssociations.some((a) => String(a.id || "").toLowerCase() === normalizedEntityId)) {
              continue;
            }
            found.push({
              resource_code: entry.resource_code,
              language: article.language || entry.language,
              content_id: String(article.content_id),
              title: article.title || `Article ${article.content_id}`,
              resource_type: entry.resource_type,
              index_reference: article.index_reference,
            });
          }
          return found;
        }),
      );

      const refs: ArticleRef[] = [];
      for (const fr of fileResults) {
        if (fr.status === "fulfilled") refs.push(...fr.value);
      }
      return refs;
    }),
  );

  for (const rr of resourceResults) {
    if (rr.status === "fulfilled") matches.push(...rr.value);
  }

  const deduped = deduplicateRefs(matches);
  tracer?.addSpan("entity-bootstrap", Math.round(performance.now() - bootstrapStart), undefined, `${index.registry.length} resources, ${deduped.length} matches`);
  if (deduped.length > 0) {
    index.entity.set(normalizedEntityId, deduped);
    await storage.putJSON(key, deduped);
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

/**
 * Fast catalog build: tries R2-cached catalog first, then article lookup index,
 * then falls back to full content file scanning for media resources needing image URLs.
 */
async function buildCatalogFast(
  resourceCode: string,
  language: string,
  entry: ResourceEntry,
  env: Env,
  storage: AquiferStorage,
  sha: string,
  tracer?: RequestTracer,
): Promise<BrowseCatalogEntry[]> {
  // Check R2 for cached catalog first
  const key = catalogKey(resourceCode, sha, language);
  const { data: cached } = await storage.getJSON<BrowseCatalogEntry[]>(key, tracer);
  if (cached) return cached;

  // Try article lookup index — no content file fetches needed
  const lookup = await loadArticleLookup(resourceCode, sha, storage, tracer);
  const isMedia = entry.aquifer_type.toLowerCase() === "images" || entry.aquifer_type.toLowerCase() === "videos";

  if (lookup && !isMedia) {
    // For non-media resources, the article index has everything browse needs
    const catalog: BrowseCatalogEntry[] = Object.entries(lookup).map(([contentId, loc]) => ({
      content_id: contentId,
      title: loc.title,
      media_type: "",
      image_url: null,
      passages: loc.ref && isValidIndexReference(loc.ref)
        ? [{ start_usfm: bbcccvvvToReadable(loc.ref.includes("-") ? loc.ref.split("-")[0]! : loc.ref), end_usfm: bbcccvvvToReadable(loc.ref.includes("-") ? loc.ref.split("-")[1]! : loc.ref) }]
        : [],
    }));

    if (catalog.length > 0) {
      await storage.putJSON(key, catalog);
    }
    return catalog;
  }

  // Media resources or no lookup index — fall back to full content file scanning
  return buildCatalog(resourceCode, language, entry, env, storage, sha, true, tracer);
}

async function buildCatalog(
  resourceCode: string,
  language: string,
  entry: ResourceEntry,
  env: Env,
  storage: AquiferStorage,
  sha: string,
  skipCacheCheck = false,
  tracer?: RequestTracer,
): Promise<BrowseCatalogEntry[]> {
  const key = catalogKey(resourceCode, sha, language);
  if (!skipCacheCheck) {
    const { data: cached } = await storage.getJSON<BrowseCatalogEntry[]>(key, tracer);
    if (cached) return cached;
  }

  const files = await listContentFiles(resourceCode, language, entry.order, env, storage, sha, tracer);
  const results = await Promise.allSettled(
    files.map((file) => fetchContentFile(resourceCode, language, file, env, storage, sha, tracer)),
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
    await storage.putJSON(key, catalog);
  }
  return catalog;
}

export async function handleBrowse(
  args: Record<string, unknown>,
  env: Env,
  storage: AquiferStorage,
  ctx?: ExecutionContext,
  tracer?: RequestTracer,
) {
  const resourceCode = String(args.resource_code ?? "").trim();
  if (!resourceCode) return textResult("Missing required field: resource_code.");

  const language = String(args.language ?? "eng").trim();
  const page = Math.max(1, Number(args.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(args.page_size) || 50));

  const index = await getOrBuildIndex(env, storage, ctx, tracer);
  const entry = index.registry.find((r) => r.resource_code === resourceCode);
  if (!entry) return textResult(`Resource "${resourceCode}" not found in the registry.`);

  const sha = index.repo_shas.get(resourceCode) ?? "";
  if (!sha) return textResult(`No SHA available for resource "${resourceCode}".`);
  const catalog = await buildCatalogFast(resourceCode, language, entry, env, storage, sha, tracer);
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

// --- Scripture tool ---

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function handleScripture(
  args: Record<string, unknown>,
  env: Env,
  storage: AquiferStorage,
  ctx?: ExecutionContext,
  tracer?: RequestTracer,
) {
  const reference = String(args.reference ?? "").trim();
  if (!reference) return textResult('Please provide a Bible reference (e.g. "John 3:16", "Rom 8:28").');

  const language = String(args.language ?? "eng").trim();
  const requestedResource = args.resource_code ? String(args.resource_code).trim() : null;

  const parsed = parseReference(reference);
  if (!parsed) {
    return textResult(`Could not parse "${reference}" as a Bible reference. Try formats like "John 3:16", "Rom 8:28", "Gen 1:1-3".`);
  }

  const index = await getOrBuildIndex(env, storage, ctx, tracer);

  // Find Bible resources
  const bibleResources = index.registry.filter((r) => {
    if (requestedResource && r.resource_code !== requestedResource) return false;
    return r.aquifer_type.toLowerCase() === "bible" || r.resource_type.toLowerCase().includes("bible");
  });

  if (bibleResources.length === 0) {
    if (requestedResource) {
      // Check if the resource exists but isn't a Bible
      const nonBible = index.registry.find((r) => r.resource_code === requestedResource);
      if (nonBible) {
        const allBibles = index.registry
          .filter((r) => r.aquifer_type.toLowerCase() === "bible")
          .map((r) => r.resource_code);
        return textResult(
          `"${requestedResource}" is a ${nonBible.resource_type}, not a Bible text resource. Available Bibles: ${allBibles.join(", ")}. Omit resource_code to search all Bibles.`,
        );
      }
      return textResult(`Bible resource "${requestedResource}" not found.`);
    }
    return textResult("No Bible resources found in the Aquifer.");
  }

  // Determine which content file to fetch based on the reference
  const startRef = parsed.includes("-") ? parsed.split("-")[0]! : parsed;
  const bookNum = startRef.slice(0, 2);
  const contentFile = `${bookNum}.content.json`;

  // Fetch from all matching Bible resources in parallel
  const scriptureFetchStart = performance.now();
  const results = await Promise.allSettled(
    bibleResources.map(async (entry) => {
      const sha = index.repo_shas.get(entry.resource_code) ?? "";
      if (!sha) return null;
      const articles = await fetchContentFile(entry.resource_code, language, contentFile, env, storage, sha, tracer);
      if (!articles?.length) return null;

      // Find articles whose passage associations overlap with the requested reference
      const matching: Array<{ sortKey: string; text: string }> = [];
      for (const article of articles) {
        const passages = article.associations?.passage ?? [];
        const articleRange = article.index_reference && isValidIndexReference(article.index_reference)
          ? article.index_reference
          : null;

        let overlaps = false;
        if (articleRange && rangesOverlap(parsed, articleRange)) {
          overlaps = true;
        }
        if (!overlaps) {
          for (const p of passages) {
            const passageRange = `${p.start_ref}-${p.end_ref}`;
            if (rangesOverlap(parsed, passageRange)) {
              overlaps = true;
              break;
            }
          }
        }

        if (overlaps) {
          matching.push({
            sortKey: article.index_reference ?? article.content_id ?? "",
            text: stripHtml(article.content || ""),
          });
        }
      }

      if (matching.length === 0) return null;
      return { resource: entry, matching };
    }),
  );
  const hitsCount = results.filter((r) => r.status === "fulfilled" && r.value).length;
  tracer?.addSpan("scripture-fetch", Math.round(performance.now() - scriptureFetchStart), undefined, `${bibleResources.length} bibles, ${hitsCount} hits`);

  const sections: string[] = [];
  const readableRef = rangeToReadable(parsed);
  const VERSE_LIMIT = 30;

  let totalVerses = 0;
  let translationCount = 0;
  let truncated = false;

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { resource, matching } = result.value;
    translationCount++;

    const sorted = matching
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    const limited = sorted.length > VERSE_LIMIT
      ? (truncated = true, sorted.slice(0, VERSE_LIMIT))
      : sorted;

    totalVerses = Math.max(totalVerses, matching.length);

    sections.push(`## ${resource.title} (${resource.resource_code})`);

    // Join verse texts into flowing scripture — no per-verse headers.
    // Verse numbers are already inline from the stripped HTML content.
    const verseTexts = limited
      .map((m) => m.text.trim())
      .filter(Boolean);

    sections.push(verseTexts.join(" "));
    sections.push("");
  }

  if (sections.length === 0) {
    return textResult(`No Bible text found for ${readableRef}. The passage may not be available in current Aquifer Bible resources.`);
  }

  const truncNote = truncated
    ? `> Note: This reference spans ${totalVerses} verses across ${translationCount} translation(s). Showing first ${VERSE_LIMIT} verses per translation. Narrow to a chapter or verse range for complete text.\n\n`
    : "";

  return textResult(`# Scripture: ${readableRef}\n\n${truncNote}${sections.join("\n")}`);
}

// --- Entity profile tool ---

export async function handleEntity(
  args: Record<string, unknown>,
  env: Env,
  storage: AquiferStorage,
  ctx?: ExecutionContext,
  tracer?: RequestTracer,
) {
  const entityId = String(args.entity_id ?? "").trim();
  if (!entityId) return textResult('Please provide an entity ID (e.g. "person:David", "place:Jerusalem").');

  const language = String(args.language ?? "eng").trim();
  const index = await getOrBuildIndex(env, storage, ctx, tracer);
  const normalized = entityId.toLowerCase();

  // Find all articles referencing this entity
  let refs = index.entity.get(normalized);
  if (!refs?.length) {
    refs = await bootstrapEntityMatches(normalized, index, env, storage, tracer);
  }

  if (!refs?.length) {
    return textResult(`No articles found for entity "${entityId}".`);
  }

  refs = refs.filter((r) => r.language === language);
  if (!refs.length) {
    return textResult(`No articles found for entity "${entityId}" in language "${language}".`);
  }

  // Group by resource type for progressive disclosure
  const grouped = new Map<string, ArticleRef[]>();
  for (const ref of refs) {
    const type = ref.resource_type || "Other";
    const existing = grouped.get(type) ?? [];
    existing.push(ref);
    grouped.set(type, existing);
  }

  const sections: string[] = [];
  sections.push(`# Entity Profile: ${entityId}`);
  sections.push(`Found ${refs.length} article(s) across ${grouped.size} resource type(s).\n`);

  // Order: Dictionary first (definition), then StudyNotes, then everything else
  const typeOrder = ["Dictionary", "Study Notes", "Guide", "Images", "Maps", "Videos"];
  const sortedTypes = [...grouped.keys()].sort((a, b) => {
    const ai = typeOrder.findIndex((t) => a.toLowerCase().includes(t.toLowerCase()));
    const bi = typeOrder.findIndex((t) => b.toLowerCase().includes(t.toLowerCase()));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  for (const type of sortedTypes) {
    const typeRefs = grouped.get(type)!;
    sections.push(`## ${type} (${typeRefs.length})`);
    const shown = typeRefs.slice(0, 5);
    for (const ref of shown) {
      sections.push(formatArticleRef(ref));
    }
    if (typeRefs.length > 5) {
      sections.push(`\n_...and ${typeRefs.length - 5} more. Use search or browse to see all._`);
    }
    sections.push("");
  }

  sections.push("---");
  sections.push("_Use `get` with any article's resource_code/language/content_id to fetch full content._");

  return textResult(sections.join("\n"));
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
