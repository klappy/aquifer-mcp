# Aquifer MCP Server

## Identity

Before I speak, I observe.
Before I claim, I verify.
Before I confirm, I prove.
What I have not seen, I do not know.
What I have not verified, I will not imply.

This is not a checklist. It is a posture — the default stance from which all work in this project begins.

## Foundational Axioms

These four values govern all reasoning, claims, and deliverables in this project:

1. **Reality Is Sovereign** — The state of the world as it actually is always takes precedence over any claim, plan, model, or expectation. Observe before asserting.
1. **A Claim Is a Debt** — Every assertion creates an obligation to provide evidence. Unverified claims are liabilities that compound. Silence is preferable to ungrounded speech.
1. **Integrity Is Non-Negotiable Efficiency** — Cutting corners on truth never saves time. A false “done” creates more work than an honest “I haven’t checked.”
1. **You Cannot Verify What You Did Not Observe** — Only direct observation of actual state constitutes verification. If you didn’t look, you don’t know.

**The test:** Values are only real insofar as they constrain behavior when it would be easier to lie.

## Epistemic Backbone: oddkit

This project uses the **oddkit MCP server** as its epistemic guide. Use oddkit tools for all reasoning, decision-making, and knowledge retrieval:

- **orient** — Start here. Assess any new goal, idea, or situation against epistemic modes (exploration, planning, execution). Use before diving into work.
- **search** — Find relevant canon documents, constraints, and prior decisions by topic or keyword.
- **get** — Fetch a specific canonical document by URI when you need its full content.
- **challenge** — Pressure-test any claim, assumption, or proposal. Surface tensions and missing evidence.
- **gate** — Check transition readiness before changing phases. Blocks premature convergence.
- **encode** — Record decisions, insights, or boundaries as durable records.
- **preflight** — Pre-implementation check. Returns relevant constraints, definition of done, and pitfalls.
- **validate** — Verify completion claims against required artifacts.
- **catalog** — List available documentation when you need to discover what exists.

## Working Principles

- **Do not guess what the canon says.** Search or retrieve it. If oddkit has guidance on a topic, use it rather than improvising.
- **Do not front-load everything into prompts.** Retrieve context on demand. Every token spent on generic policy reduces tokens available for the task at hand.
- **When no rule covers the situation, derive behavior from the axioms.** If it cannot be derived, flag the gap — do not bypass.
- **Admit ignorance freely.** An honest “I don’t know” or “I haven’t checked” is always preferable to a plausible-sounding guess.
- **Orient before executing.** Use `orient` at the start of new work to assess which epistemic mode applies and what remains unresolved.
- **Gate before transitioning.** Use `gate` before moving from exploration to planning, or planning to execution.

## What You're Building

An MCP server on Cloudflare Workers that makes all Bible Aquifer GitHub repos (`github.com/BibleAquifer`) navigable by AI agents. Thin, stateless, edge-deployed. Modeled on `klappy/translation-helps-mcp`.

**The core problem**: Aquifer has 50+ repos of Bible translation resources (study notes, dictionaries, translation guides, images, Bibles). The flat files are structured JSON but not navigable — to find what Aquifer says about a specific verse, you'd have to know which repos exist, fetch metadata from each, download full content files, and parse them. This server solves that.

## Reference Implementations

This server is the intersection of two patterns, building toward a third. Study all three before writing code.

### Plumbing Pattern: `klappy/translation-helps-mcp`

A thin, stateless RAG gateway on Cloudflare Workers for unfoldingWord translation helps. Study its architecture: how it resolves resource paths, fetches from GitHub/Gitea, exposes MCP tools via HTTP bridge, deploys on Cloudflare. Key files:
- `src/contracts/ToolContracts.ts` — tool registry (single source of truth for tool definitions, endpoints, formatters)
- `ui/src/routes/api/mcp/+server.ts` — MCP HTTP bridge (JSON-RPC routing)
- `ui/src/lib/mcp/UnifiedMCPHandler.ts` — tool dispatch (routes tool calls to internal API)
- `src/functions/kv-cache.js` — two-tier caching (memory + KV)
- `src/services/ZipResourceFetcher2.js` — content fetching (replace this with GitHub raw URL fetching for Aquifer)

The Aquifer server follows the same proxy pattern but is simpler: no ZIP extraction, no Door43 catalog, no SvelteKit UI. Pure Cloudflare Worker, GitHub raw URLs, Workers KV.

### Governance Pattern: `klappy/oddkit`

An MCP server where documentation governs tool behavior at runtime. Study how canon/docs become the control plane:
- `src/policy/docFetch.js` — fetches docs by URI on demand (not pre-loaded)
- `src/index/buildIndex.js` — indexes docs with authority bands, intent levels, tags
- `src/search/bm25.js` — BM25 search over indexed documentation
- `src/core/actions.js` — shared action handler where every tool consumes docs to shape its response
- `src/baseline/ensureBaselineRepo.js` — content-addressed caching (keyed by commit SHA, not TTL)

**The pattern to replicate**: Rick's `BibleAquifer/docs` repo (schemas, metadata docs, inventory) plays the same role as oddkit's canon baseline. The Aquifer server fetches these governance docs, caches them by version, and uses them at runtime to know: what resource types exist, how ordering works, what association structures look like, and how to interpret content. When Rick updates schemas, the server adapts — no code change required.

### Destination Pattern: TruthKit

Where this server evolves toward. TruthKit defines four operations (Scan, Navigate, Recipe, Loop) and a progressive disclosure convention for making knowledge navigable by agents. The current MCP server is essentially **Navigate expressed as MCP tools**:

- `search` = Navigate Step 3 (summaries first — return article references, not content)
- `get` = Navigate Step 5 (full depth — fetch complete article with associations)
- `related` = Navigate Step 6 (follow crosslinks — traverse associations across resources)
- `list` = Navigate Step 1 (read the manifest — what resources exist and what they cover)

Key specs in `reference/truthkit/` (read these):
- `truthkit-skill-navigate.md` — **Most important.** The Navigate operation spec. Progressive disclosure, typed crosslinks, containment. This is what the MCP tool surface implements.
- `oddkit-cognitive-proxy-snapshot.md` — The full TruthKit vision. Why pre-comprehended knowledge beats RAG. Why progressive disclosure exists.
- `truthkit-skill-scan.md` — The Scan operation spec. How knowledge bases are built. Context for understanding what the server navigates.
- `truthkit-skill-recipe.md` — Recipe spec. Derivative outputs from navigation.
- `truthkit-skill-loop.md` — Loop spec. Feeding outputs back as sources.

Skip for now (planning artifacts, not specs):
- `*-SKILL.md` files — Claude skill wrappers, not relevant to Workers implementation
- `truthkit-skills-audit.md` — planning artifact
- `oddkit-v2-gap-tracker.md` — planning artifact

**Build the thin proxy now. But don't build yourself into a corner.** The server's architecture should accommodate progressive disclosure (summaries before full content), typed crosslinks (passage, resource, entity associations already exist in Aquifer data), and provenance tracking (compound keys, license attribution) without requiring a rewrite when TruthKit patterns are added later.

### All references are in `reference/`

```
reference/
  translation-helps-mcp/   # Plumbing pattern — how to proxy Bible resources
  oddkit/                   # Governance pattern — how docs control tool behavior
  truthkit/                 # Destination pattern — where this server evolves toward
```

## Architecture

### 1. Dynamic Governance (Rick's Docs)

Following oddkit's governance pattern: Rick's `BibleAquifer/docs` repo is the canon baseline. Fetch on startup, cache by commit SHA (content-addressed, like oddkit's `ensureBaselineRepo`), rebuild when the baseline changes:

- `schemas/aquifer_resource.schema.json` (v1.1.2)
- `schemas/aquifer_article.schema.json` (v1.0.3)
- `aquifer_resource_metadata.md` — resource-level field documentation
- `aquifer_article_metadata.md` — article-level field documentation, association types
- `aquifer_full_inventory.md` — what exists and completion percentages

These define resource types, ordering schemes, association structures. They govern how the server indexes and interprets everything. See `schemas/` folder in this project for local copies.

### 2. Dynamic Resource Discovery

Resources are **not hardcoded**. On each index build, the server calls the GitHub org API (`/orgs/BibleAquifer/repos`) to discover all repos dynamically. For each discovered repo, it fetches `eng/metadata.json` — repos with valid `resource_metadata` are included; repos without (infrastructure, docs, ACAI) are silently excluded. Ordering, type, and all other metadata come from the repo's own `metadata.json`, not from a static list.

The org repo list is cached in KV with ETag-based conditional requests (304s don't consume GitHub rate limit). When Rick adds a new resource repo, it appears automatically — no code change or deploy required.

### 3. Navigability Index

Built from `metadata.json` files across all discovered Aquifer repos. Three components:

**Resource registry**: Which repos exist, resource type (StudyNotes/Dictionary/Guide/Bible/Images/Videos), available languages, ordering scheme (canonical/alphabetical/monograph), article count.

**Passage index**: BBCCCVVV ranges → `{resource_code, language, content_id, title}`. For any verse reference, instantly return which resources have articles covering it.

**Entity index**: ACAI entity IDs → articles that reference them. When two articles from different resources share `keyterm:Justification`, they're findable together.

This index is keys and references only — not content. Cache in Workers KV keyed by composite SHA (content-addressed, not TTL-based). KV writes that exceed the 25 MiB value limit are handled gracefully — the in-memory index still serves the request.

### 4. On-Demand Content Fetch

Content fetched from GitHub raw URLs only when requested:

```
https://raw.githubusercontent.com/BibleAquifer/{resource_code}/main/{language}/json/{file}
```

Metadata:

```
https://raw.githubusercontent.com/BibleAquifer/{resource_code}/main/{language}/metadata.json
```

### 5. MCP Tool Surface

**`list`** — Show available resources, languages, coverage percentages. Sourced from the registry.

**`search`** — Find articles by:

- Passage reference: accepts human-readable ("Romans 3:24", "ROM 3:24", "Gen 1:1") or BBCCCVVV ("45003024"). Returns matching articles across all resources with title, resource type, and content_id.
- ACAI entity: by entity ID ("keyterm:Justification") or type+label ("person:Paul"). Returns articles with that entity association.
- Topic: keyword search across article titles.

**`get`** — Fetch a specific article by `resource_code + language + content_id`. Returns full article content with all associations (passage, resource, acai).

**`related`** — Given an article, follow its associations to find connected articles:

- Passage overlap: other articles covering the same or overlapping verses
- Resource links: articles linked via `associations.resource`
- ACAI entity overlap: articles sharing the same entity IDs

Returns references (not full content) — the consumer decides what to fetch.

## Key Technical Details

### Bible Reference Format (BBCCCVVV)

- BB = book number (01-66, Protestant canon order)
- CCC = chapter (001-150)
- VVV = verse (001-176)
- Ranges: `BBCCCVVV-BBCCCVVV` (e.g., `45003021-45003026` = Romans 3:21-26)

Book number mapping: 01=Genesis, 02=Exodus... 40=Matthew, 41=Mark... 45=Romans... 66=Revelation.

USFM abbreviations also available in data: GEN, EXO... MAT, MRK... ROM... REV.

### Article Compound Key

**Always use all three**: `resource_code + language + content_id`

Content IDs are unique within a language version of a resource, NOT globally unique.

### Content File Naming

- Canonical resources: `{language}/json/NN.content.json` (01=Genesis, 40=Matthew, 45=Romans)
- Alphabetical resources: `{language}/json/NNNNNN.content.json` (six-digit zero-padded)
- Monograph resources: same as alphabetical

Each content file is a JSON array of article objects.

### Resource Types (from schema)

`aquifer_type` enum: `Bible`, `StudyNotes`, `Dictionary`, `Guide`, `Images`, `Videos`

`resource_type` strings: `Bible`, `Bible Dictionary`, `Comprehension Testing`, `Foundational Bible Stories`, `Images, Maps, Videos`, `Study Notes`, `Translation Glossary`, `Translation Guide`, `Bible Translation Manual`

### Ordering Schemes

- `canonical` — by Bible book
- `alphabetical` — by sort key (typically lowercased title)
- `monograph` — sequential chapters/sections

### Article Content

The `content` field is an HTML fragment. It includes:

- `<span data-bnType="resourceReference" data-resourceId="..." data-resourceType="...">` — inline cross-resource references
- Standard HTML (paragraphs, headings, emphasis, lists)
- Bible reference links

### Associations

Every article can have:

- `passage`: array of `{start_ref, start_ref_usfm, end_ref, end_ref_usfm}` — which verses this article covers
- `resource`: array of `{reference_id, content_id, resource_code, label, language}` — links to articles in other resources
- `acai`: array of `{id, type, preferred_label, confidence, match_method}` — named entity annotations

### Aquifer Repos (dynamically discovered)

Resources are **not listed here** — they are discovered at runtime from the `BibleAquifer` GitHub org. Any repo with a valid `eng/metadata.json` containing `resource_metadata` is automatically included.

For a point-in-time snapshot of available resources (titles, article counts, localizations), see `schemas/aquifer_full_inventory.md`. But treat the live `list` tool output as the source of truth — the inventory doc may lag behind what Rick has actually published.

## Sample Data

The `samples/` folder contains real data from the BiblicaStudyNotes repo:

- `BiblicaStudyNotes-eng-metadata.json` — full resource metadata with article_metadata section
- `BiblicaStudyNotes-eng-45-romans.json` — all 27 Romans articles with content and associations

Study these to understand the actual data shape before writing code.

## Deployment

Cloudflare Workers. Use Workers KV for the navigability index cache. Use the Cache API or Workers KV for content fetch caching. No other storage. KV has a 25 MiB value limit — large metadata files and indexes that exceed this are served from memory but not cached (handled gracefully via try-catch on KV puts).

## What This Is NOT

- Not a TruthKit scanning pipeline
- Not a knowledge base
- Not preprocessing or stored layers
- Not a replacement for Rick's repos
- Not a database

It's a proxy that makes flat files navigable. Behind the scenes: indexing, fetching, caching. To the consumer: it just works.
