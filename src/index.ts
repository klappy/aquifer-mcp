import type { Env } from "./types.js";
import { TOOL_DEFINITIONS, handleList, handleSearch, handleGet, handleRelated } from "./tools.js";

const SERVER_INFO = {
  name: "aquifer-mcp",
  version: "0.1.0",
};

const CAPABILITIES = {
  tools: {},
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health" || (url.pathname === "/" && request.method === "GET")) {
      return jsonResponse({ status: "ok", server: SERVER_INFO });
    }

    if (url.pathname === "/mcp" && request.method === "POST") {
      return handleMcp(request, env);
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;

async function handleMcp(request: Request, env: Env): Promise<Response> {
  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };

  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  if (body.jsonrpc !== "2.0" || !body.method) {
    return jsonRpcError(body.id, -32600, "Invalid Request");
  }

  const { id, method, params } = body;

  switch (method) {
    case "initialize":
      return jsonRpcResult(id, {
        protocolVersion: "2024-11-05",
        serverInfo: SERVER_INFO,
        capabilities: CAPABILITIES,
      });

    case "notifications/initialized":
      return jsonRpcResult(id, {});

    case "ping":
      return jsonRpcResult(id, {});

    case "tools/list":
      return jsonRpcResult(id, { tools: TOOL_DEFINITIONS });

    case "tools/call":
      return handleToolCall(id, params ?? {}, env);

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

async function handleToolCall(
  id: unknown,
  params: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const toolName = String(params.name ?? "");
  const args = (params.arguments ?? {}) as Record<string, unknown>;

  try {
    let result;
    switch (toolName) {
      case "list":
        result = await handleList(args, env);
        break;
      case "search":
        result = await handleSearch(args, env);
        break;
      case "get":
        result = await handleGet(args, env);
        break;
      case "related":
        result = await handleRelated(args, env);
        break;
      default:
        return jsonRpcError(id, -32602, `Unknown tool: ${toolName}`);
    }
    return jsonRpcResult(id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonRpcResult(id, {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    });
  }
}

function jsonRpcResult(id: unknown, result: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function jsonRpcError(id: unknown, code: number, message: string): Response {
  return jsonResponse({ jsonrpc: "2.0", id, error: { code, message } });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
