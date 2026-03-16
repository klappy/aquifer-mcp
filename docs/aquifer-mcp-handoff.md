# Handoff: Aquifer MCP Server

**Date**: March 16, 2026
**From**: Planning session (Klappy + Claude, claude.ai)
**To**: Execution session (Klappy + agent, Claude Code / Cursor / Cowork)
**Companion doc**: `aquifer-mcp-oldc.md` (read first for full context)
**Source transcript**: `2026-03-09-convo-GitHub_Bible_Resource_Pipeline_Discussion.txt`
**Reference implementation**: `github.com/klappy/translation-helps-mcp`

---

## What We're Building

An MCP server on Cloudflare Workers that makes all 48 Bible Aquifer GitHub repos navigable by AI agents. Thin, stateless, edge-deployed. No cloning, no preprocessing, no new resources to manage.

**The core problem it solves**: Aquifer's flat files aren't navigable by default. To find what the Aquifer says about a specific verse, you'd have to know which repos exist, fetch metadata from each, download full content files, and parse them to find matching articles. The MCP server builds a lightweight index from existing metadata and fetches content on demand.

**The March 16 meeting** (12-1pm Pacific / 3-4pm Eastern) is where Chris demos this to Rick and Joel. Chris committed to this in the March 9 meeting, describing it as: "docs become governance to controlling an agent, and then the agent uses that to better understand how to traverse the actual data."

---

## Architecture

### 1. Dynamic Governance

On startup (cached with TTL), the server fetches `BibleAquifer/docs`:
- `aquifer_resource_schema.json` (v1.1.2) — resource structure
- `aquifer_article_schema.json` (v1.0.3) — article structure
- `aquifer_resource_metadata.md` — resource-level field documentation
- `aquifer_article_metadata.md` — article-level field documentation, association types
- `aquifer_full_inventory.md` — what exists and completion percentages

This tells the server how to interpret everything. When Rick updates schemas or adds resources, the server adapts.

### 2. Navigability Index

Built from `metadata.json` files across all repos (the `article_metadata` section already contains `index_reference` for every article without needing content files). Three components:

**Resource registry**: Which repos exist, what type (StudyNotes/Dictionary/Guide/etc.), what languages, what ordering scheme (canonical/alphabetical/monograph).

**Passage index**: BBCCCVVV ranges → `resource_code + language + content_id`. For any verse reference, instantly know which resources have articles covering it.

**Entity index**: ACAI entity IDs → which articles reference them across resources. When two articles share `keyterm:Justification`, they're findable together.

This index is keys and references only — not content. Small enough for Workers KV or in-memory cache.

### 3. On-Demand Fetch

Content is fetched from GitHub (raw content URLs) only when a specific article is requested. The server never stores or preprocesses article content.

### 4. Tool Surface

**`list`** — Show available resources, languages, coverage. Sourced from the registry.

**`search`** — Find articles by passage reference (BBCCCVVV or human-readable like "ROM 3:24"), by ACAI entity type/ID, or by topic across article titles. Returns resource type, title, language, and content_id for each match — no content fetched yet.

**`get`** — Fetch a specific article by `resource_code + language + content_id`. Returns full article content with associations.

**`related`** — Given an article, follow its associations: passage overlap (other articles covering the same verses), resource links (e.g., study note → dictionary entry), ACAI entity overlap (articles sharing the same named entities). Returns references, not full content — the agent decides what to fetch.

---

## Implementation Path

### Step 1: Study translation-helps-mcp

The reference implementation is `klappy/translation-helps-mcp`. Understand its architecture: how it resolves uW resource paths, how it fetches from GitHub, how it exposes tools, how it deploys on Cloudflare.

### Step 2: Build the Registry Loader

Fetch the list of BibleAquifer repos (from the org page or a hardcoded list initially). For each, fetch `{repo}/eng/metadata.json` (or whatever language is primary). Parse `resource_metadata` for type, ordering, language. Parse `article_metadata` for the passage index data (`index_reference` per article).

Cache in Workers KV with a TTL (daily rebuild is probably fine — Rick doesn't update hourly).

### Step 3: Build the Passage Index

From the `article_metadata` sections, build a map: BBCCCVVV range → list of `{resource_code, language, content_id, title}`. This is what makes `search("ROM 3:24")` instant.

For canonical resources, `index_reference` is already BBCCCVVV format. For alphabetical/monograph resources, use `associations.passage` from article content (may require fetching content files once to build the index — cache the result).

### Step 4: Build the Entity Index

If article-level ACAI associations are available in the metadata (they may only be in content files), build a map: ACAI entity ID → list of articles. Otherwise, build this incrementally from content files as they're fetched.

### Step 5: Implement Tools

The four tools (`list`, `search`, `get`, `related`) against the index and GitHub fetches. Start with `list` and `get` (simplest), then `search` (needs the passage index), then `related` (needs both indexes plus association following).

### Step 6: Deploy on Cloudflare Workers

Same deployment pattern as translation-helps-mcp. Workers for compute, KV for the index cache, cache API for content fetches.

---

## Key Technical Details

**GitHub content URLs**: Raw content for a specific file in a repo:
```
https://raw.githubusercontent.com/BibleAquifer/{resource_code}/main/{language}/{file}
```

**Article file naming**:
- Canonical: `NN.content.json` (01=Genesis, 40=Matthew, 45=Romans, 66=Revelation)
- Alphabetical: `NNNNNN.content.json` (six-digit zero-padded)
- Monograph: same as alphabetical

**Article compound key**: `resource_code + language + content_id` — always use all three.

**BBCCCVVV format**: BB = book (01-66), CCC = chapter (001-150), VVV = verse (001-176). Ranges use start–end. Example: `45003024` = Romans 3:24.

**Metadata location**: `{resource_code}/{language}/metadata.json` contains both `resource_metadata` and `article_metadata`.

**Content is HTML**: Article `content` fields are HTML fragments. The server serves them as-is; the consuming agent handles interpretation.

---

## What Success Looks Like

Rick and Joel see an agent that can:

1. "What resources does Aquifer have for Romans 3?" → instant list of study notes, translation notes, dictionary entries covering those verses, across all available resources
2. "Show me what Tyndale and Biblica say about Romans 3:24" → fetches both articles, presents them with attribution
3. "What key terms appear in Romans 3?" → ACAI entity lookup showing people, places, and theological terms annotated in those verses, linked to dictionary entries
4. "What other resources discuss justification?" → entity-based search across all resources sharing `keyterm:Justification`

All of this happening at edge speed, with no cloning, no preprocessing, and no new infrastructure for Rick to maintain. His repos are the source of truth. His docs govern the server. His data flows directly to any AI agent.

---

## What This Is NOT

- Not a TruthKit scanning pipeline
- Not a KB repository
- Not preprocessing or stored layers
- Not a replacement for Rick's pipeline or repos
- Not a product pitch — it's a working demo of value

---

## Files Accompanying This Handoff

| File | Purpose |
|------|---------|
| `aquifer-mcp-oldc.md` | Full OLDC from the planning session |
| `aquifer_resource_metadata.md` | Rick's resource-level docs |
| `aquifer_article_metadata.md` | Rick's article-level docs (associations, ACAI) |
| `aquifer_full_inventory.md` | Complete inventory of Aquifer resources |
| `aquifer_resource_schema.json` | Resource metadata JSON schema v1.1.2 |
| `aquifer_article_schema.json` | Article content JSON schema v1.0.3 |
| `2026-03-09-convo-*.txt` | Meeting transcript — Rick's walkthrough |
| TruthKit design docs | Background context (snapshot, gap tracker, skills, audit) |
