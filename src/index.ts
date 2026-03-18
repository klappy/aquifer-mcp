import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./types.js";
import { handleList, handleSearch, handleGet, handleRelated, handleBrowse } from "./tools.js";

function createServer(env: Env) {
  const server = new McpServer({
    name: "aquifer-mcp",
    version: "0.3.0",
  });

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
    async (args) => handleList(args, env),
  );

  server.tool(
    "search",
    'Search Aquifer articles by passage reference ("Romans 3:24", "ROM 3:24", "45003024"), ACAI entity ID ("keyterm:Justification"), or keyword in article titles. Returns article references, not full content — use get to fetch details.',
    {
      query: z.string().describe(
        'A passage reference, ACAI entity (e.g. "keyterm:Justification", "person:Paul"), or keyword to search article titles.'
      ),
    },
    async (args) => handleSearch(args, env),
  );

  server.tool(
    "get",
    "Fetch a specific Aquifer article by its compound key (resource_code + language + content_id). Returns full content with all associations including passage references, resource links, and ACAI entities.",
    {
      resource_code: z.string().describe("The resource repository name (e.g. BiblicaStudyNotes)."),
      language: z.string().describe("Language code (e.g. eng)."),
      content_id: z.string().describe("The article content ID."),
    },
    async (args) => handleGet(args, env),
  );

  server.tool(
    "related",
    "Given an article, find related articles across the entire Aquifer through passage overlap, resource associations, or shared ACAI entities. Returns references, not full content.",
    {
      resource_code: z.string().describe("The resource repository name."),
      language: z.string().describe("Language code."),
      content_id: z.string().describe("The article content ID."),
    },
    async (args) => handleRelated(args, env),
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
    async (args) => handleBrowse(args, env),
  );

  return server;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    const url = new URL(request.url);

    // Health check — keep outside MCP handler
    if (url.pathname === "/health" || (url.pathname === "/" && request.method === "GET")) {
      return new Response(
        JSON.stringify({ status: "ok", server: { name: "aquifer-mcp", version: "0.3.0" } }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const server = createServer(env);
    return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
