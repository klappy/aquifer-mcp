# PRD: Aquifer MCP v0.2.0 — Cloudflare MCP SDK Migration

**Date**: March 17, 2026
**Repo**: `github.com/klappy/aquifer-mcp`
**Deployed at**: `https://aquifer-mcp.klappy.workers.dev`
**Current version**: v0.1.1 (all content bugs fixed, 37/39 tests passing)

-----

## One Goal

Migrate from the hand-rolled JSON-RPC handler to the **Cloudflare Agents SDK** (`createMcpHandler`) so the server speaks standard **Streamable HTTP transport** — making it compatible with all MCP clients, not just curl.

## Why

The server currently works perfectly for direct API calls (all tools, all 13 resources, all languages). But it uses a custom JSON-RPC-over-POST implementation that is **not recognized as a valid MCP server** by:

- **Claude.ai** custom connectors (Settings → Connectors)
- **Claude Desktop**
- **Cursor**, **VS Code**, **Windsurf**
- **Claude Code** (`claude mcp add`)
- Any tool using the official `@modelcontextprotocol/sdk` client

The Cloudflare Agents SDK wraps our existing tools in proper Streamable HTTP transport (with automatic SSE fallback) — zero changes to tool logic, just how they're served.

## Current State (v0.1.1 — verified March 17, 2026)

All functionality works. Here's the live test results:

|Category                                                                  |Result                |
|--------------------------------------------------------------------------|----------------------|
|`list` (filters by type, language)                                        |✅ 3/3                 |
|`search` by passage (Genesis, Romans, John, Revelation)                   |✅ 4/4                 |
|`search` by keyword (faith, Jesus, Abraham, grace, justification)         |✅ 5/5                 |
|`search` by ACAI entity (keyterm:Believe, person:Jesus.2, place:Jerusalem)|✅ 3/4 (1 timeout)     |
|`get` canonical resources (5 resources)                                   |✅ 5/5                 |
|`get` alphabetical resources (7 resources)                                |✅ 7/7                 |
|`get` monograph (OBS stories 1, 32, 50)                                   |✅ 3/3                 |
|`get` non-English (spa, fra)                                              |✅ 2/3 (1 timeout)     |
|`related` (canonical + alphabetical + monograph)                          |✅ 5/5                 |
|**Total**                                                                 |**37/39 (2 timeouts)**|

**Do not break any of this.** The tool logic is proven and correct.

-----

## What to Change

### 1. Install SDK dependencies

```bash
npm install agents @modelcontextprotocol/sdk zod
```

### 2. Rewrite `src/index.ts` only

Replace the hand-rolled JSON-RPC handler with `createMcpHandler`. The existing tool handlers stay exactly as-is.

**Current architecture** (remove):

```
request → hand-rolled JSON-RPC parser → switch(method) → switch(toolName) → handler
```

**New architecture** (replace with):

```
request → createMcpHandler(McpServer) → Streamable HTTP transport → handler
```

**New `src/index.ts`:**

```typescript
import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./types.js";
import { handleList, handleSearch, handleGet, handleRelated } from "./tools.js";

function createServer(env: Env) {
  const server = new McpServer({
    name: "aquifer-mcp",
    version: "0.2.0",
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

  return server;
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(request.url);

    // Health check — keep outside MCP handler
    if (url.pathname === "/health" || (url.pathname === "/" && request.method === "GET")) {
      return new Response(
        JSON.stringify({ status: "ok", server: { name: "aquifer-mcp", version: "0.2.0" } }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const server = createServer(env);
    return createMcpHandler(server, { route: "/mcp" })(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
```

### 3. Update `src/tools.ts`

Remove the `TOOL_DEFINITIONS` export — tools are now registered via `server.tool()` with zod schemas in `index.ts`.

Keep ALL handler functions (`handleList`, `handleSearch`, `handleGet`, `handleRelated`) and all internal helpers exactly as-is. They already return `{ content: [{ type: "text", text: "..." }] }` which is the standard MCP tool response format.

### 4. Do NOT change

- `src/registry.ts` — index building
- `src/github.ts` — GitHub content fetching
- `src/references.ts` — BBCCCVVV parsing
- `src/types.ts` — type definitions
- `wrangler.toml` — no Durable Objects needed, stateless handler is correct
- KV namespace bindings
- Any tool handler logic

-----

## wrangler.toml

No changes required. `createMcpHandler()` is stateless — no Durable Objects. The existing config works as-is.

-----

## Verification

### Step 1: Confirm Streamable HTTP transport

```bash
curl -v -X POST https://aquifer-mcp.klappy.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

Should respond with SSE/event-stream content type, not plain JSON.

### Step 2: Confirm health check still works

```bash
curl https://aquifer-mcp.klappy.workers.dev/health
# → {"status":"ok","server":{"name":"aquifer-mcp","version":"0.2.0"}}
```

### Step 3: Re-run the full test suite

Run the test script to confirm all 37+ tests still pass. The tool logic didn't change, so this should be a formality.

### Step 4: Connect to Claude.ai

1. Settings → Connectors
1. "Add custom connector"
1. Name: "Aquifer MCP"
1. URL: `https://aquifer-mcp.klappy.workers.dev/mcp`
1. No auth (server is public, all content is open-licensed)

### Step 5: Test from Claude.ai

Ask Claude: "What resources are available in the Bible Aquifer?" — should invoke the `list` tool.

Ask Claude: "What does the Aquifer say about Romans 3:24?" — should invoke `search` then `get`.

-----

## Reference Docs

- `createMcpHandler` API: https://developers.cloudflare.com/agents/api-reference/mcp-handler-api/
- Build a Remote MCP Server: https://developers.cloudflare.com/agents/guides/remote-mcp-server/
- MCP Tools: https://developers.cloudflare.com/agents/model-context-protocol/tools/
- Working example: https://github.com/cloudflare/agents/tree/main/examples/mcp-worker
- Claude.ai custom connectors: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp

-----

## Summary

This is a **transport-layer change only**. The server already works. We're just wrapping the same tools in the standard MCP SDK so every AI tool can connect to it.

|What             |Before (v0.1.1)              |After (v0.2.0)                        |
|-----------------|-----------------------------|--------------------------------------|
|Transport        |Custom JSON-RPC over POST    |Streamable HTTP (MCP spec)            |
|Tool logic       |handleList/Search/Get/Related|Same, unchanged                       |
|Claude.ai        |❌ Can't connect              |✅ Custom connector                    |
|Claude Desktop   |❌ Can't connect              |✅ Native MCP                          |
|Cursor/VS Code   |❌ Can't connect              |✅ Native MCP                          |
|Claude Code      |❌ Can't connect              |✅ `claude mcp add`                    |
|curl / direct API|✅ Works                      |✅ Still works                         |
|Dependencies     |None (hand-rolled)           |agents, @modelcontextprotocol/sdk, zod|
