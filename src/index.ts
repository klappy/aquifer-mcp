import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
  "Access-Control-Expose-Headers": "mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

function createServer(env: Env, ctx: ExecutionContext, tracer: RequestTracer) {
  const storage = new AquiferStorage(env, caches);

  const server = new McpServer({
    name: "aquifer-mcp",
    version: "1.2.0",
  });

  server.tool(
    "readme",
    "Fetch the latest aquifer-mcp README as plain markdown text from the deployed repository. Useful when an MCP client needs usage docs in-band.",
    {
      refresh: z.boolean().optional().describe("If true, bypass KV cache and fetch README from GitHub."),
    },
    async (args) => handleReadme(args, env),
  );

  server.tool(
    "telemetry_policy",
    "Return Aquifer MCP telemetry and sharing policy guidance. Use this to implement privacy-safe usage reporting without collecting user-identifying or content data.",
    {
      surface: z.string().optional().describe(
        "Optional client surface key for targeted guidance. Supported: mcp-client, aquifer-window.",
      ),
    },
    async (args) => handleTelemetryPolicy(args, env),
  );

  server.tool(
    "telemetry_public",
    "Return public telemetry disclosures and usage leaderboards for Aquifer MCP consumers and tool usage.",
    {
      limit: z.number().optional().describe("Maximum leaderboard entries to return for each ranking (default: 10, max: 50)."),
    },
    async (args) => handleTelemetryPublic(args, env),
  );

  server.tool(
    "list",
    "List available Aquifer resources with type, language, article count, and coverage. Use this to discover what the Aquifer contains before searching.",
    {
      type: z.string().optional().describe(
        "Filter by resource type: StudyNotes, Dictionary, Guide, Bible, Images, Videos. Omit for all."
      ),
      language: z.string().optional().describe(
        "Filter by language code (e.g. eng, spa, fra). Omit for all."
      ),
    },
    async (args) => handleList(args, env, storage, ctx, tracer),
  );

  server.tool(
    "search",
    'Search Aquifer articles by passage reference ("Romans 3:24", "ROM 3:24", "Rom 3:24", "45003024"), ACAI entity ID ("keyterm:Justification"), or keyword in article titles. Returns article references, not full content — use get to fetch details.',
    {
      query: z.string().describe(
        'A passage reference, ACAI entity (e.g. "keyterm:Justification", "person:Paul"), or keyword to search article titles.'
      ),
    },
    async (args) => handleSearch(args, env, storage, ctx, tracer),
  );

  server.tool(
    "get",
    "Fetch a specific Aquifer article by its compound key (resource_code + language + content_id). Returns full content with all associations including passage references, resource links, and ACAI entities.",
    {
      resource_code: z.string().describe("The resource repository name (e.g. BiblicaStudyNotes)."),
      language: z.string().describe("Language code (e.g. eng)."),
      content_id: z.string().describe("The article content ID."),
    },
    async (args) => handleGet(args, env, storage, ctx, tracer),
  );

  server.tool(
    "related",
    "Given an article, find related articles across the entire Aquifer through passage overlap, resource associations, or shared ACAI entities. Returns references, not full content.",
    {
      resource_code: z.string().describe("The resource repository name."),
      language: z.string().describe("Language code."),
      content_id: z.string().describe("The article content ID."),
    },
    async (args) => handleRelated(args, env, storage, ctx, tracer),
  );

  server.tool(
    "browse",
    "Browse the complete article catalog for a resource. Returns a paginated list of all articles with titles, content IDs, image URLs, and passage associations. Use this to discover what articles exist in a resource — especially useful for media/image resources where search may not cover them.",
    {
      resource_code: z.string().describe("The resource repository name (e.g. FIAMaps, UbsImages)."),
      language: z.string().optional().describe("Language code (default: eng)."),
      page: z.number().optional().describe("Page number, 1-indexed (default: 1)."),
      page_size: z.number().optional().describe("Articles per page, 1-100 (default: 50)."),
    },
    async (args) => handleBrowse(args, env, storage, ctx, tracer),
  );

  server.tool(
    "scripture",
    'Fetch Bible text for a passage reference. Accepts natural language ("Romans 3:16"), ' +
    'USFM codes ("ROM 3:16"), or abbreviations ("Jn 3:16", "Gen 1:1-3"). ' +
    'Returns text from available Aquifer Bible resources.',
    {
      reference: z.string().describe('Bible reference: "John 3:16", "Rom 8:28", "Gen 1:1-3"'),
      resource_code: z.string().optional().describe("Specific Bible resource code. Omit for all available."),
      language: z.string().optional().describe("Language code (default: eng)."),
    },
    async (args) => handleScripture(args, env, storage, ctx, tracer),
  );

  server.tool(
    "entity",
    'Get a profile summary for a biblical entity (person, place, keyterm). ' +
    'Returns dictionary entries, study note references, related maps/images, ' +
    'and theological links — aggregated across all Aquifer resources. ' +
    'Use this as a starting point, then use get for full article content.',
    {
      entity_id: z.string().describe(
        'ACAI entity ID (e.g. "person:David", "place:Jerusalem", "keyterm:Justification").'
      ),
      language: z.string().optional().describe("Language code (default: eng)."),
    },
    async (args) => handleEntity(args, env, storage, ctx, tracer),
  );

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check — keep outside MCP handler
    if (url.pathname === "/health" || (url.pathname === "/" && request.method === "GET")) {
      return new Response(
        JSON.stringify({ status: "ok", server: { name: "aquifer-mcp", version: "1.2.0" } }),
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

    // Streamable HTTP transport (agents >=0.7) requires Accept to include
    // both application/json and text/event-stream.  Older MCP clients
    // (including Aquifer Window) may omit this.  Inject the header so
    // they aren't rejected with a 406 "Not Acceptable" error.
    const accept = request.headers.get("accept") ?? "";
    const needsJson = !accept.includes("application/json");
    const needsSse = !accept.includes("text/event-stream");
    let effectiveRequest = request;
    if ((needsJson || needsSse) && url.pathname === "/mcp") {
      const parts: string[] = [accept];
      if (needsJson) parts.push("application/json");
      if (needsSse) parts.push("text/event-stream");
      const headers = new Headers(request.headers);
      headers.set("accept", parts.filter(Boolean).join(", "));
      effectiveRequest = new Request(request, { headers });
    }

    const tracer = new RequestTracer();
    const server = createServer(env, ctx, tracer);
    const response = await createMcpHandler(server, { route: "/mcp" })(effectiveRequest, env, ctx);

    // Ensure CORS headers on actual responses include x-aquifer-* headers.
    // The agents handler sets Access-Control-Allow-Origin: * but its
    // Allow-Headers list is limited to standard MCP headers.
    if (url.pathname === "/mcp") {
      const patched = new Response(response.body, response);
      patched.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
      patched.headers.set("X-Aquifer-Trace", tracer.toHeader());
      const existingExpose = patched.headers.get("Access-Control-Expose-Headers");
      patched.headers.set("Access-Control-Expose-Headers",
        [existingExpose, "X-Aquifer-Trace"].filter(Boolean).join(", "));
      return patched;
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
