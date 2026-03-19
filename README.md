# Aquifer MCP

Thin Cloudflare Workers MCP server for navigating Bible Aquifer content.

Current runtime version: `0.5.0`

Most users should use the deployed endpoint directly. Running locally is primarily for agentic contributors developing this server.

---

## What It Exposes

Aquifer MCP provides six tools:

- `readme` - fetch this README as markdown through MCP
- `list` - list resources and metadata summary
- `search` - search by passage, ACAI entity, or title keyword
- `get` - fetch full article content by compound key
- `related` - follow passage/resource/entity associations
- `browse` - paginate through full article catalogs for a resource

Health endpoint:

- `GET /health`

MCP endpoint:

- `POST /mcp`

---

## Aquifer Window Uses This Same Server

The Aquifer Window does not use a separate backend for content. It uses this exact MCP server as its content interface.

Window behavior maps directly to these tool calls:

- resource discovery -> `list`
- passage/topic/entity discovery -> `search`
- article reading -> `get`
- related-content exploration -> `related`
- paginated catalog browsing (especially media/image repos) -> `browse`

Both the agent experience and the Aquifer Window experience resolve through the same endpoint and the same retrieval path.

---

## Two Paths

### Path 1: Use it (recommended, most users)

Use the deployed endpoint directly:

- MCP URL: `https://aquifer-mcp.klappy.workers.dev/mcp`
- Health: `https://aquifer-mcp.klappy.workers.dev/health`

Cursor config:

```json
{
  "mcpServers": {
    "aquifer-mcp": {
      "url": "https://aquifer-mcp.klappy.workers.dev/mcp"
    }
  }
}
```

### Path 2: Run locally (development only)

Clone this repo and run local Worker dev if you are changing server code.

---

## Local Development

### Install

```bash
npm install
```

### Run locally

```bash
npm run dev
```

### Check health

```bash
curl http://127.0.0.1:8787/health
```

### Build and tests

```bash
npm run build
npm run test
```

### Deploy

```bash
npm run deploy
```

---

## Cursor MCP Config

Default (deployed):

```json
{
  "mcpServers": {
    "aquifer-mcp": {
      "url": "https://aquifer-mcp.klappy.workers.dev/mcp"
    }
  }
}
```

Local override for development:

- `http://127.0.0.1:8787/mcp`

---

## Tool Usage (JSON-RPC Examples)

These examples target the deployed endpoint, since that is the normal usage path.

### Initialize

```bash
curl -X POST https://aquifer-mcp.klappy.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{}
  }'
```

### List tools

```bash
curl -X POST https://aquifer-mcp.klappy.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/list",
    "params":{}
  }'
```

### `readme`

```bash
curl -X POST https://aquifer-mcp.klappy.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":9,
    "method":"tools/call",
    "params":{
      "name":"readme",
      "arguments":{"refresh":false}
    }
  }'
```

### `list`

```bash
curl -X POST https://aquifer-mcp.klappy.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/call",
    "params":{
      "name":"list",
      "arguments":{"type":"StudyNotes","language":"eng"}
    }
  }'
```

### `search`

```bash
curl -X POST https://aquifer-mcp.klappy.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":4,
    "method":"tools/call",
    "params":{
      "name":"search",
      "arguments":{"query":"Romans 3:24"}
    }
  }'
```

```bash
curl -X POST https://aquifer-mcp.klappy.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":5,
    "method":"tools/call",
    "params":{
      "name":"search",
      "arguments":{"query":"keyterm:Justification"}
    }
  }'
```

### `get`

```bash
curl -X POST https://aquifer-mcp.klappy.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":6,
    "method":"tools/call",
    "params":{
      "name":"get",
      "arguments":{
        "resource_code":"BiblicaStudyNotes",
        "language":"eng",
        "content_id":"43895"
      }
    }
  }'
```

### `related`

```bash
curl -X POST https://aquifer-mcp.klappy.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":7,
    "method":"tools/call",
    "params":{
      "name":"related",
      "arguments":{
        "resource_code":"BiblicaStudyNotes",
        "language":"eng",
        "content_id":"43895"
      }
    }
  }'
```

### `browse`

```bash
curl -X POST https://aquifer-mcp.klappy.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":8,
    "method":"tools/call",
    "params":{
      "name":"browse",
      "arguments":{
        "resource_code":"FIAMaps",
        "language":"eng",
        "page":1,
        "page_size":25
      }
    }
  }'
```

`browse` defaults:

- `language`: `eng`
- `page`: `1`
- `page_size`: `50`
- `page_size` max: `100`

---

## Architecture Summary

### Runtime surface

- Cloudflare Worker entrypoint in `src/index.ts`
- MCP server created with `@modelcontextprotocol/sdk` and `agents/mcp`
- tools wired directly to handlers in `src/tools.ts`

### Retrieval model

1. Build/load navigability index from Aquifer metadata
2. Resolve references from index for `list` and `search`
3. Fetch content files on demand for `get`, `related`, and `browse`
4. Return text content payloads in MCP responses

### Caching

- Workers KV binding: `AQUIFER_CACHE`
- cache keys are content-addressed by Git commit SHA (not time-window keys)
- repo SHAs are checked against GitHub (ETag-aware) before cache reuse
- KV TTL (`GC_TTL`) is 30 days for garbage collection, not freshness truth

---

## Data Assumptions

- Article key is always `resource_code + language + content_id`
- Passage references use BBCCCVVV format
- Passage range matching uses `start-end` BBCCCVVV strings
- Metadata source is `/{language}/metadata.json`
- Content source is `/{language}/json/*.content.json`

---

## A First-Person Build Account

Klappy gave me one clear direction: do not build a heavy platform, build a thin navigable layer.

He pointed me to Oddkit for epistemic posture, pointed me to prior MCP work for implementation shape, and pointed me to Rick Brannan's Aquifer docs and repos for source truth. From there I built this as a Cloudflare Worker that indexes metadata, retrieves content on demand, and exposes predictable MCP tools for agents and apps.

In this latest codebase, that includes the explicit `browse` tool so catalog exploration is first-class, and v0.4 content-addressed SHA-keyed caching so freshness comes from observed repo state instead of TTL assumptions.

And the Aquifer Window story stays the same: it uses this server as its content backend. The Window and agent clients are two interfaces over the same corpus and the same MCP endpoint.

Two slices of one pie:

- Aquifer Window = human exploration
- Aquifer MCP = agent navigation
