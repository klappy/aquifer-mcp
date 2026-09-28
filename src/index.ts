import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "./types.js";
import {
  handleList,
  handleSearch,
  handleGet,
  handleRelated,
  handleBrowse,
  handleReadme,
  handleTelemetryPolicy,
  handleTelemetryPublic,
  handleScripture,
  handleEntity,
} from "./tools.js";
import { recordPublicTelemetry } from "./telemetry.js";
import { AquiferStorage } from "./storage.js";
import { RequestTracer } from "./tracing.js";
import { VERSION } from "./version.js";

const ALLOWED_HEADERS = [
  "Content-Type",
  "Accept",
  "Authorization",
  "mcp-session-id",
  "MCP-Protocol-Version",
  "x-aquifer-client",
  "x-aquifer-client-version",
  "x-aquifer-agent-name",
  "x-aquifer-agent-version",
  "x-aquifer-surface",
  "x-aquifer-contact-url",
  "x-aquifer-policy-url",
  "x-aquifer-capabilities",
].join(", ");

const CORS_PREFLIGHT_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": ALLOWED_HEADERS,
  "Access-Control-Expose-Headers": "X-Aquifer-Trace",
  "Access-Control-Max-Age": "86400",
};

function createServer(env: Env, ctx: ExecutionContext, tracer: RequestTracer) {
  const storage = new AquiferStorage(env, caches);

  const server = new McpServer({
    name: "aquifer-mcp",
    version: VERSION,
  });

  server.registerTool(
    "readme",
    { description: "Fetch the latest aquifer-mcp README as plain markdown text from the deployed repository. Useful when an MCP client needs usage docs in-band.",
    inputSchema: z.object({
      refresh: z.boolean().optional().describe("If true, bypass KV cache and fetch README from GitHub."),
    }) },
    async (args) => handleReadme(args, env),
  );

  server.registerTool(
    "telemetry_policy",
    { description: "Return Aquifer MCP telemetry and sharing policy guidance. Use this to implement privacy-safe usage reporting without collecting user-identifying or content data.",
    inputSchema: z.object({
      surface: z.string().optional().describe(
        "Optional client surface key for targeted guidance. Supported: mcp-client, aquifer-window.",
      ),
    }) },
    async (args) => handleTelemetryPolicy(args, env),
  );

  server.registerTool(
    "telemetry_public",
    { description: "Return public telemetry disclosures and usage leaderboards for Aquifer MCP consumers and tool usage.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Maximum leaderboard entries to return for each ranking (default: 10, max: 50)."),
    }) },
    async (args) => handleTelemetryPublic(args, env),
  );

  server.registerTool(
    "list",
    { description: "List available Aquifer resources with type, language, article count, and coverage. Use this to discover what the Aquifer contains before searching.",
    inputSchema: z.object({
      type: z.string().optional().describe(
        "Filter by resource type: StudyNotes, Dictionary, Guide, Bible, Images, Videos. Omit for all."
      ),
      language: z.string().optional().describe(
        "Filter by language code (e.g. eng, spa, fra). Omit for all."
      ),
    }) },
    async (args) => handleList(args, env, storage, ctx, tracer),
  );

  server.registerTool(
    "search",
    { description: 'Search Aquifer articles by passage reference ("Romans 3:24", "ROM 3:24", "Rom 3:24", "45003024"), ACAI entity ID ("keyterm:Justification"), or keyword in article titles. Returns article references, not full content — use get to fetch details.',
    inputSchema: z.object({
      query: z.string().describe(
        'A passage reference, ACAI entity (e.g. "keyterm:Justification", "person:Paul"), or keyword to search article titles.'
      ),
    }) },
    async (args) => handleSearch(args, env, storage, ctx, tracer),
  );

  server.registerTool(
    "get",
    { description: "Fetch a specific Aquifer article by its compound key (resource_code + language + content_id). Returns full content with all associations including passage references, resource links, and ACAI entities.",
    inputSchema: z.object({
      resource_code: z.string().describe("The resource repository name (e.g. BiblicaStudyNotes)."),
      language: z.string().describe("Language code (e.g. eng)."),
      content_id: z.string().describe("The article content ID."),
      include_media: z.boolean().optional().describe("Include source-bound media descriptors; bounded scans may require continuation."),
      scan_cursor: z.string().optional().describe("Opaque server-owned continuation from prior result."),
    }) },
    async (args) => handleGet(args, env, storage, ctx, tracer),
  );

  server.registerTool(
    "related",
    { description: "Given an article, find related articles across the entire Aquifer through passage overlap, resource associations, or shared ACAI entities. Returns references, not full content.",
    inputSchema: z.object({
      resource_code: z.string().describe("The resource repository name."),
      language: z.string().describe("Language code."),
      content_id: z.string().describe("The article content ID."),
    }) },
    async (args) => handleRelated(args, env, storage, ctx, tracer),
  );

  server.registerTool(
    "browse",
    { description: "Browse the complete article catalog for a resource. Returns a paginated list of all articles with titles, content IDs, image URLs, and passage associations. Use this to discover what articles exist in a resource — especially useful for media/image resources where search may not cover them.",
    inputSchema: z.object({
      resource_code: z.string().describe("The resource repository name (e.g. FIAMaps, UBSImages)."),
      language: z.string().optional().describe("Language code. Defaults to the resource's primary language (eng for English resources, e.g. fra for a French-only resource)."),
      page: z.number().optional().describe("Page number, 1-indexed (default: 1)."),
      page_size: z.number().optional().describe("Articles per page, 1-100 (default: 50)."),
      modality: z.enum(['audio','video','image','text']).optional().describe("Article modality, separate from collection type."),
      scan_cursor: z.string().optional().describe("Opaque server-owned scan continuation; omit to restart failed discovery."),
    }) },
    async (args) => handleBrowse(args, env, storage, ctx, tracer),
  );

  server.registerTool(
    "scripture",
    { description: 'Fetch Bible text for a passage reference. Accepts natural language ("Romans 3:16"), ' +
    'USFM codes ("ROM 3:16"), or abbreviations ("Jn 3:16", "Gen 1:1-3"). ' +
    'Returns text from available Aquifer Bible resources.',
    inputSchema: z.object({
      reference: z.string().describe('Bible reference: "John 3:16", "Rom 8:28", "Gen 1:1-3"'),
      resource_code: z.string().optional().describe("Specific Bible resource code. Omit for all available."),
      language: z.string().optional().describe("Language code (default: eng)."),
    }) },
    async (args) => handleScripture(args, env, storage, ctx, tracer),
  );

  server.registerTool(
    "entity",
    { description: 'Get a profile summary for a biblical entity (person, place, keyterm). ' +
    'Returns dictionary entries, study note references, related maps/images, ' +
    'and theological links — aggregated across all Aquifer resources. ' +
    'Use this as a starting point, then use get for full article content.',
    inputSchema: z.object({
      entity_id: z.string().describe(
        'ACAI entity ID (e.g. "person:David", "place:Jerusalem", "keyterm:Justification").'
      ),
      language: z.string().optional().describe("Language code (default: eng)."),
    }) },
    async (args) => handleEntity(args, env, storage, ctx, tracer),
  );

  return server;
}

function mcpGetKeepalive(request: Request): Response {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        if (timer) clearInterval(timer);
        timer = undefined;
        try { controller.close(); } catch { /* already closed */ }
      };
      timer = setInterval(() => {
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch { stop(); }
      }, 25_000);
      request.signal?.addEventListener("abort", stop);
    },
    cancel() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": ALLOWED_HEADERS,
      "Access-Control-Expose-Headers": "X-Aquifer-Trace",
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check — keep outside MCP handler
    if (url.pathname === "/health" || (url.pathname === "/" && request.method === "GET")) {
      return new Response(
        JSON.stringify({ status: "ok", server: { name: "aquifer-mcp", version: VERSION } }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // CORS preflight — handle before the MCP handler so browser clients
    // sending custom x-aquifer-* headers aren't rejected.
    if (request.method === "OPTIONS" && url.pathname === "/mcp") {
      return new Response(null, { status: 204, headers: CORS_PREFLIGHT_HEADERS });
    }

    if (url.pathname === "/mcp" && request.method === "POST") {
      ctx.waitUntil(recordPublicTelemetry(request, env));
    }

    // GET /mcp SSE keepalive shim (borrowed from klappy/oddkit PR #236, RESULTS-S1b).
    // The v2 stateless handler answers the standalone SSE GET with 405 — the
    // cartographer 0.17.0 rollback signature (Claude.ai: GET /mcp 405, zero tools).
    // This server never pushes, so an idle stream of SSE comments is the whole contract.
    if (url.pathname === "/mcp" && request.method === "GET" &&
        (request.headers.get("Accept") ?? "").includes("text/event-stream")) {
      return mcpGetKeepalive(request);
    }

    const tracer = new RequestTracer();

    // MCP 2026-07-28 stateless core: @modelcontextprotocol/server v2 via agents'
    // stateless createMcpHandler with a per-request server factory. The SDK answers
    // server/discover, reads protocol version + client capabilities from each
    // request's _meta, returns -32022 (UnsupportedProtocolVersionError) on an
    // unsupported version, and serves 2025-era initialize clients statelessly
    // (legacy: "stateless"). No mcp-session-id is issued or exposed.
    const handler = createMcpHandler(() => createServer(env, ctx, tracer), {
      route: "/mcp",
      legacy: "stateless",
      corsOptions: {
        origin: "*",
        methods: "GET, POST, DELETE, OPTIONS",
        headers: ALLOWED_HEADERS,
        exposeHeaders: "X-Aquifer-Trace",
        maxAge: 86400,
      },
      // Public, unauthenticated, read-only server with browser clients
      // (aquifer-window); prior behaviour was CORS "*" with no Origin check.
      allowedOriginHostnames: "*",
    });
    const response = await handler(request, env, ctx);

    if (url.pathname === "/mcp") {
      const patched = new Response(response.body, response);
      patched.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
      patched.headers.set("X-Aquifer-Trace", tracer.toHeader());
      const expose = (patched.headers.get("Access-Control-Expose-Headers") ?? "")
        .split(",").map((h) => h.trim())
        .filter((h) => h && h.toLowerCase() !== "mcp-session-id" && h !== "X-Aquifer-Trace");
      patched.headers.set("Access-Control-Expose-Headers", [...expose, "X-Aquifer-Trace"].join(", "));
      return patched;
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
