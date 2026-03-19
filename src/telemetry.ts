import type { Env } from "./types.js";
import { GC_TTL } from "./github.js";
import { parseReference } from "./references.js";

const MAX_LABEL_LENGTH = 80;
const VERIFIED_SCORE_MULTIPLIER = 10;
const SELF_REPORT_FIELDS = [
  "client_name",
  "client_version",
  "agent_name",
  "agent_version",
  "surface",
  "contact_url",
  "policy_url",
  "capabilities",
] as const;
const SELF_REPORT_FIELD_MAX = SELF_REPORT_FIELDS.length;

interface TelemetryPrefixes {
  base: string;
  mcp_requests: string;
  tool_calls: string;
  last_recorded_at: string;
  labelSource: string;
  method: string;
  tool: string;
  consumer: string;
  consumerWeighted: string;
  consumerVerification: string;
  consumerSelfReportPoints: string;
  consumerSelfReportMax: string;
  selfReportField: string;
  resource: string;
  language: string;
  article: string;
  searchType: string;
  lastArticle: string;
  passageVerse: string;
  passageChapter: string;
  passageBook: string;
  passageTestament: string;
}

function buildPrefixes(env: Env): TelemetryPrefixes {
  const workerEnv = env.WORKER_ENV ?? "production";
  const base = `telemetry:v1:${workerEnv}`;
  return {
    base,
    mcp_requests: `${base}:mcp_requests`,
    tool_calls: `${base}:tool_calls`,
    last_recorded_at: `${base}:last_recorded_at`,
    labelSource: `${base}:consumer-source:`,
    method: `${base}:method:`,
    tool: `${base}:tool:`,
    consumer: `${base}:consumer:`,
    consumerWeighted: `${base}:consumer-weighted:`,
    consumerVerification: `${base}:consumer-verification:`,
    consumerSelfReportPoints: `${base}:consumer-self-report-points:`,
    consumerSelfReportMax: `${base}:consumer-self-report-max:`,
    selfReportField: `${base}:self-report-field:`,
    resource: `${base}:resource:`,
    language: `${base}:language:`,
    article: `${base}:article:`,
    searchType: `${base}:search-type:`,
    lastArticle: `${base}:last_article`,
    passageVerse: `${base}:passage-verse:`,
    passageChapter: `${base}:passage-chapter:`,
    passageBook: `${base}:passage-book:`,
    passageTestament: `${base}:passage-testament:`,
  };
}

type ConsumerLabelSource =
  | "x-aquifer-client"
  | "initialize.clientInfo.name"
  | "user-agent"
  | "unknown";

export interface TelemetryRankItem {
  name: string;
  calls: number;
}

export interface TransparencyLeaderboardItem {
  name: string;
  calls: number;
  details_shared: number;
  details_possible: number;
  completeness_pct: number;
  badge: string;
}

export interface LastArticleRecord {
  resource_code: string;
  language: string;
  content_id: string;
  tool: string;
  accessed_at: string;
}

export interface PublicTelemetrySnapshot {
  schema_version: string;
  tracked_fields: string[];
  tracked_field_notes: string[];
  excluded_fields: string[];
  totals: {
    mcp_requests: number;
    tool_calls: number;
  };
  method_counts: TelemetryRankItem[];
  consumer_label_sources: TelemetryRankItem[];
  consumer_verification_counts: TelemetryRankItem[];
  self_report_field_counts: TelemetryRankItem[];
  leaderboards: {
    consumers: TelemetryRankItem[];
    consumers_weighted: TelemetryRankItem[];
    tools: TelemetryRankItem[];
    resources: TelemetryRankItem[];
    languages: TelemetryRankItem[];
    articles: TelemetryRankItem[];
    transparency: TransparencyLeaderboardItem[];
  };
  search_type_counts: TelemetryRankItem[];
  passage_counts: {
    testaments: TelemetryRankItem[];
    books: TelemetryRankItem[];
    chapters: TelemetryRankItem[];
    verses: TelemetryRankItem[];
  };
  last_article: LastArticleRecord | null;
  last_recorded_at: string | null;
}

function sanitizeLabel(input: string): string {
  return input
    .trim()
    .replace(/[^a-zA-Z0-9._:/ -]/g, "")
    .slice(0, MAX_LABEL_LENGTH) || "unknown";
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return "unknown";
  const first = ua.split(/\s+/)[0] ?? "";
  return sanitizeLabel(first);
}

function parseJsonRpcMethod(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const method = (payload as { method?: unknown }).method;
  return typeof method === "string" ? method : null;
}

function parseClientInfoName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const params = (payload as { params?: unknown }).params;
  if (!params || typeof params !== "object") return null;
  const clientInfo = (params as { clientInfo?: unknown }).clientInfo;
  if (!clientInfo || typeof clientInfo !== "object") return null;
  const name = (clientInfo as { name?: unknown }).name;
  return typeof name === "string" ? sanitizeLabel(name) : null;
}

function parseClientInfoVersion(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const params = (payload as { params?: unknown }).params;
  if (!params || typeof params !== "object") return null;
  const clientInfo = (params as { clientInfo?: unknown }).clientInfo;
  if (!clientInfo || typeof clientInfo !== "object") return null;
  const version = (clientInfo as { version?: unknown }).version;
  return typeof version === "string" ? sanitizeLabel(version) : null;
}

function parseToolName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const method = parseJsonRpcMethod(payload);
  if (method !== "tools/call") return null;
  const params = (payload as { params?: unknown }).params;
  if (!params || typeof params !== "object") return null;
  const name = (params as { name?: unknown }).name;
  return typeof name === "string" ? sanitizeLabel(name.toLowerCase()) : null;
}

interface ToolArguments {
  resource_code?: string;
  language?: string;
  content_id?: string;
  query?: string;
  type?: string;
}

function parseToolArguments(payload: unknown): ToolArguments | null {
  if (!payload || typeof payload !== "object") return null;
  const params = (payload as { params?: unknown }).params;
  if (!params || typeof params !== "object") return null;
  const args = (params as { arguments?: unknown }).arguments;
  if (!args || typeof args !== "object") return null;

  const result: ToolArguments = {};
  const a = args as Record<string, unknown>;
  if (typeof a.resource_code === "string") result.resource_code = sanitizeLabel(a.resource_code);
  if (typeof a.language === "string") result.language = sanitizeLabel(a.language);
  if (typeof a.content_id === "string") result.content_id = sanitizeLabel(a.content_id);
  if (typeof a.query === "string") result.query = a.query;
  if (typeof a.type === "string") result.type = sanitizeLabel(a.type.toLowerCase());
  return Object.keys(result).length > 0 ? result : null;
}

export function classifySearchType(query: string): "passage" | "entity" | "title" {
  const trimmed = query.trim();
  if (/^[a-z]+:/i.test(trimmed)) return "entity";
  if (/\d+:\d+/.test(trimmed) || /^\d{8}$/.test(trimmed)) return "passage";
  return "title";
}

export function passageHierarchy(bbcccvvv: string): {
  verse: string;
  chapter: string;
  book: string;
  testament: "ot" | "nt";
} | null {
  const start = bbcccvvv.includes("-") ? bbcccvvv.split("-")[0]! : bbcccvvv;
  if (start.length !== 8 || !/^\d{8}$/.test(start)) return null;
  const bookNum = parseInt(start.slice(0, 2), 10);
  if (bookNum < 1 || bookNum > 66) return null;
  return {
    verse: start,
    chapter: start.slice(0, 5),
    book: start.slice(0, 2),
    testament: bookNum <= 39 ? "ot" : "nt",
  };
}

async function incrementCounter(env: Env, key: string): Promise<void> {
  await incrementCounterBy(env, key, 1);
}

async function incrementCounterBy(env: Env, key: string, by: number): Promise<void> {
  const raw = await env.AQUIFER_CACHE.get(key);
  const current = Number(raw ?? "0");
  const next = Number.isFinite(current) ? current + by : by;
  await env.AQUIFER_CACHE.put(key, String(next), { expirationTtl: GC_TTL });
}

async function readCounters(env: Env, prefix: string): Promise<Array<{ key: string; calls: number }>> {
  let cursor: string | undefined;
  const results: Array<{ key: string; calls: number }> = [];

  do {
    const page = await env.AQUIFER_CACHE.list({ prefix, cursor, limit: 1000 });
    const entries = await Promise.all(
      page.keys.map(async (keyEntry) => {
        const raw = await env.AQUIFER_CACHE.get(keyEntry.name);
        const calls = Number(raw ?? "0");
        return { key: keyEntry.name, calls };
      }),
    );
    for (const entry of entries) {
      if (!Number.isFinite(entry.calls) || entry.calls <= 0) continue;
      results.push(entry);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return results;
}

function getConsumerLabelInfo(
  request: Request,
  payload: unknown,
  batchClientName?: string,
): { label: string; source: ConsumerLabelSource } {
  const explicit = request.headers.get("x-aquifer-client");
  if (explicit) return { label: sanitizeLabel(explicit), source: "x-aquifer-client" };
  const fromInitialize = parseClientInfoName(payload);
  if (fromInitialize) return { label: fromInitialize, source: "initialize.clientInfo.name" };
  if (batchClientName) return { label: sanitizeLabel(batchClientName), source: "initialize.clientInfo.name" };
  const userAgentLabel = parseUserAgent(request.headers.get("user-agent"));
  if (userAgentLabel !== "unknown") return { label: userAgentLabel, source: "user-agent" };
  return { label: "unknown", source: "unknown" };
}

function normalizePayloads(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  return [payload];
}

function getVerifiedClientSet(env: Env): Set<string> {
  const raw = String(env.TELEMETRY_VERIFIED_CLIENTS ?? "");
  const entries = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return new Set(entries);
}

function getHeaderValue(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  if (!value) return null;
  const cleaned = sanitizeLabel(value);
  return cleaned && cleaned !== "unknown" ? cleaned : null;
}

function badgeForCompleteness(pct: number): string {
  if (pct >= 90) return "Open Ledger";
  if (pct >= 70) return "Clear Reporter";
  if (pct >= 40) return "Starter Reporter";
  if (pct > 0) return "Hint Reporter";
  return "Silent Reporter";
}

function getSelfReportDetails(
  request: Request,
  payload: unknown,
  batchClientName?: string,
  batchClientVersion?: string,
): Record<(typeof SELF_REPORT_FIELDS)[number], boolean> {
  const clientNameFromHeaders = getHeaderValue(request, "x-aquifer-client");
  const clientNameFromPayload = parseClientInfoName(payload) ?? batchClientName ?? null;
  const clientVersionFromHeaders = getHeaderValue(request, "x-aquifer-client-version");
  const clientVersionFromPayload = parseClientInfoVersion(payload) ?? batchClientVersion ?? null;

  return {
    client_name: Boolean(clientNameFromHeaders || clientNameFromPayload),
    client_version: Boolean(clientVersionFromHeaders || clientVersionFromPayload),
    agent_name: Boolean(getHeaderValue(request, "x-aquifer-agent-name")),
    agent_version: Boolean(getHeaderValue(request, "x-aquifer-agent-version")),
    surface: Boolean(getHeaderValue(request, "x-aquifer-surface")),
    contact_url: Boolean(getHeaderValue(request, "x-aquifer-contact-url")),
    policy_url: Boolean(getHeaderValue(request, "x-aquifer-policy-url")),
    capabilities: Boolean(getHeaderValue(request, "x-aquifer-capabilities")),
  };
}

async function recordPassageHierarchy(env: Env, p: TelemetryPrefixes, bbcccvvv: string): Promise<void> {
  const hierarchy = passageHierarchy(bbcccvvv);
  if (!hierarchy) return;
  await Promise.all([
    incrementCounter(env, `${p.passageVerse}${hierarchy.verse}`),
    incrementCounter(env, `${p.passageChapter}${hierarchy.chapter}`),
    incrementCounter(env, `${p.passageBook}${hierarchy.book}`),
    incrementCounter(env, `${p.passageTestament}${hierarchy.testament}`),
  ]);
}

export async function recordPublicTelemetry(request: Request, env: Env): Promise<void> {
  if (request.method !== "POST") return;

  const url = new URL(request.url);
  if (url.pathname !== "/mcp") return;

  const p = buildPrefixes(env);

  let payload: unknown = null;
  try {
    payload = await request.clone().json();
  } catch {
    // Ignore malformed non-JSON bodies in telemetry path.
  }

  const messages = normalizePayloads(payload);
  const verifiedClients = getVerifiedClientSet(env);
  const batchClientName = messages
    .map((message) => parseClientInfoName(message))
    .find((name): name is string => Boolean(name));
  const batchClientVersion = messages
    .map((message) => parseClientInfoVersion(message))
    .find((version): version is string => Boolean(version));

  for (const message of messages) {
    const method = parseJsonRpcMethod(message) ?? "unknown";
    await incrementCounter(env, p.mcp_requests);
    await incrementCounter(env, `${p.method}${sanitizeLabel(method.toLowerCase())}`);

    if (method === "tools/call") {
      await incrementCounter(env, p.tool_calls);

      const consumerInfo = getConsumerLabelInfo(request, message, batchClientName);
      const isVerified = verifiedClients.has(consumerInfo.label.toLowerCase());
      const weightedScore = isVerified ? VERIFIED_SCORE_MULTIPLIER : 1;
      const selfReportDetails = getSelfReportDetails(request, message, batchClientName, batchClientVersion);
      const selfReportPoints = SELF_REPORT_FIELDS.reduce(
        (sum, field) => sum + (selfReportDetails[field] ? 1 : 0),
        0,
      );
      await incrementCounter(env, `${p.consumer}${consumerInfo.label}`);
      await incrementCounterBy(env, `${p.consumerWeighted}${consumerInfo.label}`, weightedScore);
      await incrementCounter(env, `${p.labelSource}${consumerInfo.source}`);
      await incrementCounter(env, `${p.consumerVerification}${isVerified ? "verified" : "unverified"}`);
      await incrementCounterBy(env, `${p.consumerSelfReportPoints}${consumerInfo.label}`, selfReportPoints);
      await incrementCounterBy(env, `${p.consumerSelfReportMax}${consumerInfo.label}`, SELF_REPORT_FIELD_MAX);
      for (const field of SELF_REPORT_FIELDS) {
        if (selfReportDetails[field]) {
          await incrementCounter(env, `${p.selfReportField}${field}`);
        }
      }

      const toolName = parseToolName(message) ?? "unknown";
      await incrementCounter(env, `${p.tool}${toolName}`);

      const toolArgs = parseToolArguments(message);
      if (toolArgs) {
        if (toolArgs.resource_code) {
          await incrementCounter(env, `${p.resource}${toolArgs.resource_code}`);
        }
        if (toolArgs.language) {
          await incrementCounter(env, `${p.language}${toolArgs.language}`);
        }
        if (toolName === "list" && toolArgs.type) {
          await incrementCounter(env, `${p.resource}type:${toolArgs.type}`);
        }
        if (toolArgs.resource_code && toolArgs.language && toolArgs.content_id) {
          const articleKey = `${toolArgs.resource_code}:${toolArgs.language}:${toolArgs.content_id}`;
          await incrementCounter(env, `${p.article}${articleKey}`);
          await env.AQUIFER_CACHE.put(
            p.lastArticle,
            JSON.stringify({
              resource_code: toolArgs.resource_code,
              language: toolArgs.language,
              content_id: toolArgs.content_id,
              tool: toolName,
              accessed_at: new Date().toISOString(),
            } satisfies LastArticleRecord),
            { expirationTtl: GC_TTL },
          );
        }
        if (toolName === "search" && toolArgs.query) {
          const searchType = classifySearchType(toolArgs.query);
          await incrementCounter(env, `${p.searchType}${searchType}`);
          if (searchType === "passage") {
            const ref = parseReference(toolArgs.query);
            if (ref) {
              await recordPassageHierarchy(env, p, ref);
            }
          }
        }
      }
    }
  }

  await env.AQUIFER_CACHE.put(p.last_recorded_at, new Date().toISOString(), {
    expirationTtl: GC_TTL,
  });
}

export async function getPublicTelemetrySnapshot(env: Env, limit: number): Promise<PublicTelemetrySnapshot> {
  const p = buildPrefixes(env);

  const [
    mcpRequestsRaw,
    toolCallsRaw,
    lastRecordedAt,
    lastArticleRaw,
    consumerCounters,
    consumerWeightedCounters,
    toolCounters,
    methodCounters,
    sourceCounters,
    verificationCounters,
    selfReportPointsCounters,
    selfReportMaxCounters,
    selfReportFieldCounters,
    resourceCounters,
    languageCounters,
    articleCounters,
    searchTypeCounters,
    passageTestamentCounters,
    passageBookCounters,
    passageChapterCounters,
    passageVerseCounters,
  ] = await Promise.all([
    env.AQUIFER_CACHE.get(p.mcp_requests),
    env.AQUIFER_CACHE.get(p.tool_calls),
    env.AQUIFER_CACHE.get(p.last_recorded_at),
    env.AQUIFER_CACHE.get(p.lastArticle),
    readCounters(env, p.consumer),
    readCounters(env, p.consumerWeighted),
    readCounters(env, p.tool),
    readCounters(env, p.method),
    readCounters(env, p.labelSource),
    readCounters(env, p.consumerVerification),
    readCounters(env, p.consumerSelfReportPoints),
    readCounters(env, p.consumerSelfReportMax),
    readCounters(env, p.selfReportField),
    readCounters(env, p.resource),
    readCounters(env, p.language),
    readCounters(env, p.article),
    readCounters(env, p.searchType),
    readCounters(env, p.passageTestament),
    readCounters(env, p.passageBook),
    readCounters(env, p.passageChapter),
    readCounters(env, p.passageVerse),
  ]);

  const toRank = (counters: Array<{ key: string; calls: number }>, prefix: string) =>
    counters
      .map((item) => ({ name: item.key.replace(prefix, ""), calls: item.calls }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, limit);

  const consumers = toRank(consumerCounters, p.consumer);
  const tools = toRank(toolCounters, p.tool);
  const consumersWeighted = toRank(consumerWeightedCounters, p.consumerWeighted);
  const methods = toRank(methodCounters, p.method);
  const consumerLabelSources = toRank(sourceCounters, p.labelSource);
  const consumerVerificationCounts = toRank(verificationCounters, p.consumerVerification);
  const selfReportFieldCounts = toRank(selfReportFieldCounters, p.selfReportField);
  const resources = toRank(resourceCounters, p.resource);
  const languages = toRank(languageCounters, p.language);
  const articles = toRank(articleCounters, p.article);
  const searchTypes = toRank(searchTypeCounters, p.searchType);
  const passageTestaments = toRank(passageTestamentCounters, p.passageTestament);
  const passageBooks = toRank(passageBookCounters, p.passageBook);
  const passageChapters = toRank(passageChapterCounters, p.passageChapter);
  const passageVerses = toRank(passageVerseCounters, p.passageVerse);

  const pointsByConsumer = new Map(
    selfReportPointsCounters.map((item) => [item.key.replace(p.consumerSelfReportPoints, ""), item.calls]),
  );
  const maxByConsumer = new Map(
    selfReportMaxCounters.map((item) => [item.key.replace(p.consumerSelfReportMax, ""), item.calls]),
  );
  const callCountByConsumer = new Map(
    consumerCounters.map((item) => [item.key.replace(p.consumer, ""), item.calls]),
  );
  const transparencyLeaderboard: TransparencyLeaderboardItem[] = Array.from(
    new Set([...pointsByConsumer.keys(), ...maxByConsumer.keys(), ...callCountByConsumer.keys()]),
  )
    .map((name) => {
      const detailsShared = pointsByConsumer.get(name) ?? 0;
      const detailsPossible = maxByConsumer.get(name) ?? 0;
      const calls = callCountByConsumer.get(name) ?? 0;
      const pct = detailsPossible > 0 ? Math.round((detailsShared / detailsPossible) * 100) : 0;
      return {
        name,
        calls,
        details_shared: detailsShared,
        details_possible: detailsPossible,
        completeness_pct: pct,
        badge: badgeForCompleteness(pct),
      };
    })
    .sort((a, b) => {
      if (b.completeness_pct !== a.completeness_pct) return b.completeness_pct - a.completeness_pct;
      if (b.details_shared !== a.details_shared) return b.details_shared - a.details_shared;
      return b.calls - a.calls;
    })
    .slice(0, limit);

  let lastArticle: LastArticleRecord | null = null;
  if (lastArticleRaw) {
    try {
      lastArticle = JSON.parse(lastArticleRaw) as LastArticleRecord;
    } catch { /* ignore malformed */ }
  }

  return {
    schema_version: "telemetry-public-v2",
    tracked_fields: [
      "automatic_tool_call_tracking",
      "jsonrpc_method_count",
      "mcp_request_count",
      "tool_call_count",
      "tool_call_count_by_tool_name",
      "tool_call_count_by_consumer_label",
      "tool_call_weighted_score_by_consumer_label",
      "consumer_self_report_completeness",
      "consumer_label_source_count",
      "consumer_verification_count",
      "self_report_field_presence_count",
      "resource_access_count",
      "language_access_count",
      "article_access_count",
      "search_type_count",
      "passage_hierarchy_counts",
      "last_article_accessed",
      "last_recorded_at",
    ],
    tracked_field_notes: [
      "All tools/call usage is tracked automatically by the server on /mcp POST envelopes.",
      "Current server tracking is aggregate counters, not per-request event logs.",
      "Consumer labels are self-declared and should be treated as transparent claims, not identity proof.",
      `Verified consumer labels (from env allowlist) receive ${VERIFIED_SCORE_MULTIPLIER}x weighted leaderboard score.`,
      "Self-reported metadata completeness is scored from optional disclosure fields to incentivize richer transparency.",
      "Resource, language, and article access counts are extracted from tool arguments (structural identifiers only, no raw query text).",
      "Search type classification (passage/entity/title) is derived from query pattern, not the query content itself.",
      "Passage searches roll up hierarchically: verse (BBCCCVVV) -> chapter (BBCCC) -> book (BB) -> testament (ot/nt).",
      "Latency/status/cache/error dimensions are policy-allowed but not yet collected by server counters.",
    ],
    excluded_fields: [
      "raw_prompt",
      "raw_query_text",
      "article_content",
      "model_response_text",
      "name",
      "email",
      "ip_address",
      "browser_fingerprint",
    ],
    totals: {
      mcp_requests: Number(mcpRequestsRaw ?? "0") || 0,
      tool_calls: Number(toolCallsRaw ?? "0") || 0,
    },
    method_counts: methods,
    consumer_label_sources: consumerLabelSources,
    consumer_verification_counts: consumerVerificationCounts,
    self_report_field_counts: selfReportFieldCounts,
    leaderboards: {
      consumers,
      consumers_weighted: consumersWeighted,
      tools,
      resources,
      languages,
      articles,
      transparency: transparencyLeaderboard,
    },
    search_type_counts: searchTypes,
    passage_counts: {
      testaments: passageTestaments,
      books: passageBooks,
      chapters: passageChapters,
      verses: passageVerses,
    },
    last_article: lastArticle,
    last_recorded_at: lastRecordedAt,
  };
}
