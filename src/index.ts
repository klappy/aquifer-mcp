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

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": ALLOWED_HEADERS,
  "Access-Control-Expose-Headers": "mcp-session-id, X-Aquifer-Trace",
  "Access-Control-Max-Age": "86400",
};

type ToolResult = { content: Array<{ type: "text"; text: string }> };

/** Tool definitions — single source of truth for tools/list and dispatch. */
const TOOL_DEFINITIONS = [
  {
    name: "readme",
    description:
      "Fetch the latest aquifer-mcp README as plain markdown text from the deployed repository. Useful when an MCP client needs usage docs in-band.",
    inputSchema: {
      type: "object" as const,
      properties: {
        refresh: {
          type: "boolean",
          description: "If true, bypass KV cache and fetch README from GitHub.",
        },
      },
    },
  },
  {
    name: "telemetry_policy",
    description:
      "Return Aquifer MCP telemetry and sharing policy guidance. Use this to implement privacy-safe usage reporting without collecting user-identifying or content data.",
    inputSchema: {
      type: "object" as const,
      properties: {
        surface: {
          type: "string",
          description:
            "Optional client surface key for targeted guidance. Supported: mcp-client, aquifer-window.",
        },
      },
    },
  },
  {
    name: "telemetry_public",
    description:
      "Return public telemetry disclosures and usage leaderboards for Aquifer MCP consumers and tool usage.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description:
            "Maximum leaderboard entries to return for each ranking (default: 10, max: 50).",
        },
      },
    },
  },
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
            "Filter by resource type: StudyNotes, Dictionary, Guide, Bible, Images, Videos. Omit for all.",
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
      'Search Aquifer articles by passage reference ("Romans 3:24", "ROM 3:24", "Rom 3:24", "45003024"), ACAI entity ID ("keyterm:Justification"), or keyword in article titles. Returns article references, not full content — use get to fetch details.',
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            'A passage reference, ACAI entity (e.g. "keyterm:Justification", "person:Paul"), or keyword to search article titles.',
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get",
    description:
      "Fetch a specific Aquifer article by its compound key (resource_code + language + content_id). Returns full content with all associations including passage references, resource links, and ACAI entities.",
    inputSchema: {
      type: "object" as const,
      properties: {
        resource_code: {
          type: "string",
          description: "The resource repository name (e.g. BiblicaStudyNotes).",
        },
        language: { type: "string", description: "Language code (e.g. eng)." },
        content_id: { type: "string", description: "The article content ID." },
      },
      required: ["resource_code", "language", "content_id"],
    },
  },
  {
    name: "related",
    description:
      "Given an article, find related articles across the entire Aquifer through passage overlap, resource associations, or shared ACAI entities. Returns references, not full content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        resource_code: {
          type: "string",
          description: "The resource repository name.",
        },
        language: { type: "string", description: "Language code." },
        content_id: { type: "string", description: "The article content ID." },
      },
      required: ["resource_code", "language", "content_id"],
    },
  },
  {
    name: "browse",
    description:
      "Browse the complete article catalog for a resource. Returns a paginated list of all articles with titles, content IDs, image URLs, and passage associations. Use this to discover what articles exist in a resource — especially useful for media/image resources where search may not cover them.",
    inputSchema: {
      type: "object" as const,
      properties: {
        resource_code: {
          type: "string",
          description:
            "The resource repository name (e.g. FIAMaps, UbsImages).",
        },
        language: {
          type: "string",
          description: "Language code (default: eng).",
        },
        page: {
          type: "number",
          description: "Page number, 1-indexed (default: 1).",
        },
        page_size: {
          type: "number",
          description: "Articles per page, 1-100 (default: 50).",
        },
      },
      required: ["resource_code"],
    },
  },
  {
    name: "scripture",
    description:
      'Fetch Bible text for a passage reference. Accepts natural language ("Romans 3:16"), ' +
      'USFM codes ("ROM 3:16"), or abbreviations ("Jn 3:16", "Gen 1:1-3"). ' +
      "Returns text from available Aquifer Bible resources.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: 'Bible reference: "John 3:16", "Rom 8:28", "Gen 1:1-3"',
        },
        resource_code: {
          type: "string",
          description:
            "Specific Bible resource code. Omit for all available.",
        },
        language: {
          type: "string",
          description: "Language code (default: eng).",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "entity",
    description:
      "Get a profile summary for a biblical entity (person, place, keyterm). " +
      "Returns dictionary entries, study note references, related maps/images, " +
      "and theological links — aggregated across all Aquifer resources. " +
      "Use this as a starting point, then use get for full article content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        entity_id: {
          type: "string",
          description:
            'ACAI entity ID (e.g. "person:David", "place:Jerusalem", "keyterm:Justification").',
        },
        language: {
          type: "string",
          description: "Language code (default: eng).",
        },
      },
      required: ["entity_id"],
    },
  },
];

function json(data: unknown, headers?: Record<string, string>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

function jsonRpc(result: unknown, id: unknown, headers?: Record<string, string>): Response {
  return json({ jsonrpc: "2.0", result, id }, headers);
}

function jsonRpcError(code: number, message: string, id: unknown): Response {
  return json({ jsonrpc: "2.0", error: { code, message }, id });
}

async function dispatchTool(
  toolName: string,
  args: Record<string, unknown>,
  env: Env,
  storage: AquiferStorage,
  ctx: ExecutionContext,
  tracer: RequestTracer,
): Promise<ToolResult> {
  switch (toolName) {
    case "readme":
      return handleReadme(args as { refresh?: boolean }, env);
    case "telemetry_policy":
      return handleTelemetryPolicy(args as { surface?: string }, env);
    case "telemetry_public":
      return handleTelemetryPublic(args as { limit?: number }, env);
    case "list":
      return handleList(args as { type?: string; language?: string }, env, storage, ctx, tracer);
    case "search":
      return handleSearch(args as { query: string }, env, storage, ctx, tracer);
    case "get":
      return handleGet(
        args as { resource_code: string; language: string; content_id: string },
        env,
        storage,
        ctx,
        tracer,
      );
    case "related":
      return handleRelated(
        args as { resource_code: string; language: string; content_id: string },
        env,
        storage,
        ctx,
        tracer,
      );
    case "browse":
      return handleBrowse(
        args as { resource_code: string; language?: string; page?: number; page_size?: number },
        env,
        storage,
        ctx,
        tracer,
      );
    case "scripture":
      return handleScripture(
        args as { reference: string; resource_code?: string; language?: string },
        env,
        storage,
        ctx,
        tracer,
      );
    case "entity":
      return handleEntity(
        args as { entity_id: string; language?: string },
        env,
        storage,
        ctx,
        tracer,
      );
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }] };
  }
}

async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  let body: { jsonrpc?: string; method?: string; params?: Record<string, unknown>; id?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(-32700, "Parse error", null);
  }

  const method = body.method;
  const id = body.id ?? null;
  const tracer = new RequestTracer();
  const storage = new AquiferStorage(env, caches);

  switch (method) {
    case "initialize":
      return jsonRpc(
        {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "aquifer-mcp", version: VERSION },
        },
        id,
      );

    case "notifications/initialized":
      return jsonRpc({}, id);

    case "tools/list":
      return jsonRpc({ tools: TOOL_DEFINITIONS }, id);

    case "tools/call": {
      const toolName = body.params?.name as string | undefined;
      const args = (body.params?.arguments ?? {}) as Record<string, unknown>;
      if (!toolName) {
        return jsonRpcError(-32602, "Missing params.name", id);
      }
      const result = await dispatchTool(toolName, args, env, storage, ctx, tracer);
      return jsonRpc(result, id, { "X-Aquifer-Trace": tracer.toHeader() });
    }

    case "ping":
      return jsonRpc({}, id);

    default:
      return jsonRpcError(-32601, `Unknown method: ${method}`, id);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health" || (url.pathname === "/" && request.method === "GET")) {
      return json({ status: "ok", server: { name: "aquifer-mcp", version: VERSION } });
    }

    // CORS preflight
    if (request.method === "OPTIONS" && url.pathname === "/mcp") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // MCP JSON-RPC endpoint
    if (url.pathname === "/mcp" && request.method === "POST") {
      ctx.waitUntil(recordPublicTelemetry(request, env));
      return handleMcpRequest(request, env, ctx);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
