# Aquifer MCP

Thin Cloudflare Workers MCP server for navigating Bible Aquifer content.

**Deploy:** Cloudflare **dashboard Git integration** builds and deploys this repo when you push (see **[DEPLOY-SETUP.md](DEPLOY-SETUP.md)**). GitHub Actions here only runs **tests**, not deploy.

Most users should use the deployed endpoint directly. Running locally is primarily for agentic contributors developing this server.

---

## A First-Person Build Account

This MCP server was built by AI coding agents with Klappy.

Klappy gave one clear direction: do not build a heavy platform, build a thin navigable layer.

Oddkit provides epistemic posture, prior MCP work provides implementation shape, and Rick Brannan's Aquifer docs and repos provide source truth. The server is a Cloudflare Worker that indexes metadata, retrieves content on demand, and exposes predictable MCP tools for agents and apps.

Capabilities include: explicit catalog browsing via `browse`, content-addressed SHA-keyed caching where freshness comes from observed repo state instead of TTL assumptions, in-band README access through the `readme` tool, dynamic resource discovery from the BibleAquifer GitHub org so new resources appear automatically with zero code changes, deterministic Bible verse retrieval via the `scripture` tool, and named entity profiling via the `entity` tool.

The Aquifer Window uses this server as its content backend. The Window and agent clients are two interfaces over the same corpus and the same MCP endpoint.

Production URLs:

- Aquifer MCP: `https://aquifer.klappy.dev/mcp`
- Aquifer Window: `https://aquifer-window.klappy.dev`

**Staging preview** (git branch `staging`): **`https://staging-aquifer-mcp.klappy.workers.dev`** (`/health`, `/mcp` — same as production). Other branches: **`https://<branch-slug>-aquifer-mcp.klappy.workers.dev`** (slug matches branch name; check Cloudflare if a branch has an odd slug).

Two slices of one pie:

- Aquifer Window = human exploration
- Aquifer MCP (this) = agent navigation

---

## What It Exposes

Aquifer MCP provides ten tools:

- `readme` - fetch this README as markdown through MCP
- `telemetry_policy` - fetch telemetry-sharing policy and client integration guidance
- `telemetry_public` - fetch public telemetry snapshot and consumer/tool leaderboards
- `list` - list resources and metadata summary
- `search` - search by passage, ACAI entity, or title keyword
- `get` - fetch full article content by compound key
- `related` - follow passage/resource/entity associations
- `browse` - paginate through full article catalogs for a resource
- `scripture` - fetch Bible verse text by reference (e.g. "Rom 3:23-25") across all translations
- `entity` - profile a named entity by ACAI ID (e.g. "person:David") showing all associated articles

Health endpoint:

- `GET /health`

MCP endpoint:

- `POST /mcp`

---

## Aquifer Window Uses This Same Server

The Aquifer Window does not use a separate backend for content. It uses this exact MCP server as its content interface.

Live Window URL: `https://aquifer-window.klappy.dev`

Window behavior maps directly to these tool calls:

- resource discovery -> `list`
- passage/topic/entity discovery -> `search`
- article reading -> `get`
- related-content exploration -> `related`
- paginated catalog browsing (especially media/image repos) -> `browse`
- Bible verse reading -> `scripture`
- entity profiling -> `entity`

Both the agent experience and the Aquifer Window experience resolve through the same endpoint and the same retrieval path.

---

## Two Paths

### Path 1: Use it (recommended, most users)

Use the deployed endpoint directly:

- MCP URL: `https://aquifer.klappy.dev/mcp`
- Health: `https://aquifer.klappy.dev/health`

Cursor config:

```json
{
  "mcpServers": {
    "aquifer-mcp": {
      "url": "https://aquifer.klappy.dev/mcp"
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

**Branch strategy** and **preview URLs** (`staging` → `https://staging-aquifer-mcp.klappy.workers.dev`) are in [`docs/branch-and-deployment-strategy.md`](docs/branch-and-deployment-strategy.md) and [`DEPLOY-SETUP.md`](DEPLOY-SETUP.md).

**Deploy path:** push your branch → Cloudflare builds → use the **preview** or **production** URL the dashboard shows. No GitHub secrets required for deploy in this repo.

- **CLI fallback (emergency):** `npm run deploy` — logged-in Wrangler (`deploy:staging` is for **local Wrangler** `[env.staging]`, not the Git preview hostname)

GitHub Actions: **build + test only** (`.github/workflows/ci.yml` on PRs).

---

## Cursor MCP Config

Default (deployed):

```json
{
  "mcpServers": {
    "aquifer-mcp": {
      "url": "https://aquifer.klappy.dev/mcp"
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
curl -X POST https://aquifer.klappy.dev/mcp \
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
curl -X POST https://aquifer.klappy.dev/mcp \
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
curl -X POST https://aquifer.klappy.dev/mcp \
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

### `telemetry_policy`

```bash
curl -X POST https://aquifer.klappy.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":10,
    "method":"tools/call",
    "params":{
      "name":"telemetry_policy",
      "arguments":{"surface":"mcp-client"}
    }
  }'
```

### `telemetry_public`

```bash
curl -X POST https://aquifer.klappy.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":11,
    "method":"tools/call",
    "params":{
      "name":"telemetry_public",
      "arguments":{"limit":10}
    }
  }'
```

### `list`

```bash
curl -X POST https://aquifer.klappy.dev/mcp \
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
curl -X POST https://aquifer.klappy.dev/mcp \
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
curl -X POST https://aquifer.klappy.dev/mcp \
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
curl -X POST https://aquifer.klappy.dev/mcp \
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
curl -X POST https://aquifer.klappy.dev/mcp \
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
curl -X POST https://aquifer.klappy.dev/mcp \
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

### `scripture`

```bash
curl -X POST https://aquifer.klappy.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":12,
    "method":"tools/call",
    "params":{
      "name":"scripture",
      "arguments":{"reference":"Rom 3:23-25"}
    }
  }'
```

```bash
curl -X POST https://aquifer.klappy.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":13,
    "method":"tools/call",
    "params":{
      "name":"scripture",
      "arguments":{"reference":"John 3:16","resource_code":"BereanStandardBible"}
    }
  }'
```

### `entity`

```bash
curl -X POST https://aquifer.klappy.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":14,
    "method":"tools/call",
    "params":{
      "name":"entity",
      "arguments":{"id":"person:David"}
    }
  }'
```

```bash
curl -X POST https://aquifer.klappy.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":15,
    "method":"tools/call",
    "params":{
      "name":"entity",
      "arguments":{"id":"keyterm:Justification"}
    }
  }'
```

---

## Architecture Summary

### Runtime surface

- Cloudflare Worker entrypoint in `src/index.ts`
- MCP server created with `@modelcontextprotocol/sdk` and `agents/mcp`
- tools wired directly to handlers in `src/tools.ts`

### Resource discovery

Resources are discovered dynamically from the BibleAquifer GitHub organization — no hardcoded list. On each index build the server queries the org API (ETag-cached), fetches `eng/metadata.json` from every repo, and includes any repo that has valid `resource_metadata`. New resources Rick adds appear automatically; repos without metadata are silently excluded.

### Retrieval model

1. Discover repos from GitHub org, build/load navigability index from metadata
2. Resolve references from index for `list`, `search`, and `entity`
3. Fetch content files on demand for `get`, `related`, `browse`, and `scripture`
4. Return text content payloads in MCP responses

### Caching

- Workers KV binding: `AQUIFER_CACHE`
- cache keys are content-addressed by Git commit SHA (not time-window keys)
- repo SHAs are checked against GitHub (ETag-aware) before cache reuse
- KV TTL (`GC_TTL`) is 30 days for garbage collection, not freshness truth

---

## Telemetry And Sharing Policy

Aquifer MCP aims to maximize operational visibility while preserving user anonymity by default.

Telemetry should measure system behavior, not people:

- Collect aggregate operational counters (JSON-RPC method counts, tool-call totals, tool leaderboards, consumer-label leaderboards, label-source counts)
- Track all `tools/call` usage automatically at the server transport layer (no client opt-in required)
- Treat consumer labels as transparent self-declarations (for openness/gamification), not identity proof unless allowlisted as verified
- Apply weighted leaderboard scoring where verified clients are worth `10x` per tool call
- Incentivize richer self-report metadata through a public transparency leaderboard and badge system
- Do not collect user-identifying or content-bearing data by default
- Do not collect raw prompts, raw query text, article content, model responses, names, emails, IP addresses, or fingerprint data

For in-band client guidance, call the `telemetry_policy` tool from your client integration.
For aggregate transparency and gamified usage visibility, call `telemetry_public`.
For a single-page governance reference, see `docs/telemetry-governance-snapshot.md`.

Supported `surface` values:

- `mcp-client`
- `aquifer-window`

If no surface is provided, `telemetry_policy` returns the base policy.

`telemetry_public` returns:

- aggregate request and tool-call totals
- top calling consumer labels
- weighted consumer leaderboard (verified clients score `10x`)
- transparency leaderboard (self-report completeness + badges)
- top-used MCP tools
- method counts, consumer-label source counts, verification-class counts, and self-report field coverage counts
- explicit tracked/excluded field lists
- last telemetry update timestamp

Optional env var for weighted verification:

- `TELEMETRY_VERIFIED_CLIENTS` - comma-separated consumer labels treated as verified for the 10x weighted leaderboard (example: `Cursor,ClaudeDesktop,AquiferWindow`)

Recommended self-report headers (honor-system unless verified):

- `x-aquifer-client`
- `x-aquifer-client-version`
- `x-aquifer-agent-name`
- `x-aquifer-agent-version`
- `x-aquifer-surface`
- `x-aquifer-contact-url`
- `x-aquifer-policy-url`
- `x-aquifer-capabilities`

---

## Data Assumptions

- Article key is always `resource_code + language + content_id`
- Passage references use BBCCCVVV format
- Passage range matching uses `start-end` BBCCCVVV strings
- Metadata source is `/{language}/metadata.json`
- Content source is `/{language}/json/*.content.json`
