# OLDC: Aquifer MCP Server

**Date**: March 16, 2026
**Session**: Planning session — Klappy + Claude (claude.ai)
**Status**: Encoded via oddkit
**Deliverable**: An MCP server on Cloudflare Workers that makes all Bible Aquifer GitHub repos navigable by AI agents — modeled on klappy/translation-helps-mcp

---

## Observations

**O1: What Bible Aquifer Is.** Bible Aquifer (`github.com/BibleAquifer`) is an open-source collection of openly-licensed Bible translation resources published as flat JSON + Markdown files on GitHub by BiblioNexus / Mission Mutual (Rick Brannan, `rickb@missionmutual.org`). Content partners include Biblica, Tyndale, SRV Partners, unfoldingWord, UBS. 48 resource repositories covering Study Notes, Bible Dictionaries, Translation Guides, Images, Videos, and Bibles across 9+ gateway languages. All CC0/CC-BY/CC-BY-SA licensed.

**O2: Rick's Pipeline.** Rick built a Python pipeline (since ~Nov 2025) that pulls from the Aquifer API through export → update → render stages, outputting JSON (single source of truth), Markdown, PDF, and DOCX. The Aquifer API is article-at-a-time (groups of 1000, cycle individually) — unfoldingWord Translation Notes alone has ~70,000 articles. Content comes from the database as HTML via TipTap conversion. Rick created three ordering schemes (canonical, alphabetical, monograph) because the database had no inherent ordering.

**O3: Aquifer's Data Model.** Article schema (v1.0.3) includes `associations` with three link types: `passage` (BBCCCVVV verse refs), `resource` (cross-resource links by content_id/resource_code), and `acai` (named entity annotations — person, place, group, deity, flora, fauna, realia, keyterm — with confidence scores). Resource schema (v1.1.2) defines resource types, ordering, review levels (None/Community/Professional), Scripture Burrito metadata. Content IDs are unique within a language version of a resource, not globally.

**O4: The Flat Files Aren't Navigable.** This is the core problem. To answer "what does Aquifer say about Romans 3:24" you'd have to: know which repos exist and cover Romans, fetch metadata.json from each, fetch eng/45.content.json from each canonical resource, parse JSON arrays to find articles whose passage associations include 45003024, then follow resource associations to dictionary entries, then match ACAI entities. That's many fetches and full file parses before you get content.

**O5: translation-helps-mcp Already Solves This for uW.** Klappy's `klappy/translation-helps-mcp` is a thin, stateless RAG gateway on Cloudflare that lets AI agents fetch unfoldingWord translation helps at edge speed — no cloning, no preprocessing. It works because it understands uW's structure and makes it navigable. Aquifer needs the same thing.

**O6: Rick's Docs Repo IS the Governance.** `BibleAquifer/docs` contains schema definitions and metadata documentation. This tells the MCP server how to interpret every resource type, ordering scheme, and association pattern. When Rick updates schemas or adds resources, the server adapts without code changes.

**O7: Joel's Strategic Vision.** Static GitHub files as primary source, API as optional projection. Content developers in control, not software developers. Adding new resources should be as cheap as adding a new repository.

**O8: Meeting Context.** March 9 was the first meeting (Chris, Rick, Joel). Chris committed to demo flat-file AI projection work on March 16 (12-1pm Pacific / 3-4pm Eastern). Standing biweekly meetings established. Chris described the concept to Rick: "docs that you have for the other repositories become governance to controlling an agent, and then the agent uses that to better understand how to traverse the actual data."

**O9: ACAI Is New and Valuable.** Rick added ACAI associations ~2 weeks before March 9. The ACAI dataset annotates named entities at the word level of Hebrew OT and Greek NT. Entity IDs in article associations provide cross-resource alignment — when two articles share `keyterm:Justification`, they're related. Rick included all matches with scores, leaving filtering to consumers.

---

## Learnings

**L1: The Problem Is Navigability, Not Comprehension.** Aquifer's data is already structured JSON with associations. It doesn't need AI preprocessing to be useful — it needs a thin proxy that understands the structure and makes it queryable by passage reference, entity, or topic without opening every file.

**L2: Associations Are Crosslink Seeds.** Passage associations provide the join key (BBCCCVVV). Resource associations provide link targets. ACAI provides entity-level alignment. These already exist in the data. At query time, an LLM can characterize relationship types (confirms/contradicts/extends) if needed — no pre-computation required.

**L3: Schema Documentation = Dynamic Governance.** The docs repo defines what the server should expect. Resource type determines how to interpret content. BBCCCVVV is the location standard. review_level informs authority. This governance is fetched and cached, not hardcoded.

**L4: Don't Create New Resources to Manage.** Every round of simplification in this session stripped out something that would have been a new maintenance burden — KB repo, scanning pipeline, stored layers. The translation-helps-mcp pattern proves you can get most of the value with a stateless proxy and caching.

**L5: TruthKit Principles Belong in Agent Behavior, Not Infrastructure.** Progressive disclosure (search returns references, get returns content — agent decides depth), containment (attribute to sources), typed relationships (characterized at query time) — these are patterns the agent follows when using the tools, not features the server pre-computes.

**L6: Chris Already Described This to Rick.** "Docs become governance to controlling an agent, and then the agent uses that to better understand how to traverse the actual data." The MCP server delivers on exactly that promise.

**L7: Content IDs Are Scoped.** Unique within language version of a resource, not global. The compound key is `resource_code + language + content_id`.

**L8: Rick Is Pragmatic.** He'll use whatever works. He's open to Cloudflare, open to new approaches. The server should respect his existing structure, not impose a new one.

**L9: The Index Is the Key Innovation.** What makes Aquifer navigable is a lightweight index (passage → articles, entities → articles, resource registry) built from metadata that already exists in the repos. Small enough for Workers KV. This is the difference between "fetch 12 files to answer one question" and "one lookup, two fetches."

---

## Decisions

**D1: Single MCP Server on Cloudflare Workers.** Modeled on translation-helps-mcp. Thin, stateless, edge-deployed. No new repos, no new storage beyond cache/KV.

**D2: Dynamic Governance from Docs Repo.** Server fetches BibleAquifer/docs to understand schemas, resource types, ordering, associations. Cached with TTL. Adapts automatically when Rick updates.

**D3: Lightweight Navigability Index.** Built from resource-level metadata.json files across repos. Three components: resource registry (what exists), passage index (BBCCCVVV → resource + article), entity index (ACAI IDs → articles). Keys and references only, not content. Workers KV or cache.

**D4: On-Demand Content Fetch.** Content fetched from GitHub only when requested. The server is a proxy, not a warehouse. No preprocessing, no scanning, no stored layers.

**D5: Four Tools.** `search` (by passage ref, topic, or ACAI entity), `get` (specific article by resource_code + language + content_id), `related` (follow associations across resources), `list` (available resources/languages/coverage).

**D6: TruthKit Principles in Behavior.** Progressive disclosure, containment, typed relationships — expressed through how the agent uses the tools, not through server-side infrastructure.

**What was explicitly rejected:**
- KB repository (new resource to maintain)
- Pre-scanning/preprocessing pipeline (too heavy)
- TruthKit layers stored as files (infrastructure without observed pain)
- Any architecture requiring new persistent storage beyond cache

**This is reversible.** If query-time characterization proves too slow at scale, caching layers can be added incrementally. Start thin.

---

## Constraints

**C1: No New Resources.** The server manages nothing beyond its own code and a cache. No repos, no databases, no stored KB.

**C2: License Preservation.** CC-BY and CC-BY-SA attribution from resource metadata must be surfaced when serving content. The server passes through licensing info, it doesn't strip it.

**C3: BBCCCVVV Is the Location Standard.** Passage queries use Aquifer's verse reference format. Don't invent a different scheme.

**C4: Compound Keys for Articles.** `resource_code + language + content_id` — never assume content IDs are globally unique.

**C5: Respect Rick's Structure.** The server reads from repos as Rick built them. It doesn't impose a new organization, require Rick to change anything, or duplicate content.

**C6: Demo, Not Pitch.** March 16 meeting is showing value. The output speaks for itself.

---

## People

- **Rick Brannan** (`rickb@missionmutual.org`) — Built the pipeline and repos. Pragmatic. Created ACAI dataset. Knows Aquifer internals deeply.
- **Joel** — Facilitator, strategic thinker. Vision: static files primary, API optional. BiblioNexus.
- **Chris (Klappy)** — Building the MCP server. Committed to March 16 demo.

## Timeline

- **March 9**: First meeting — Rick walkthrough, Chris listened. Committed to demo.
- **March 16**: Demo meeting — 12-1pm Pacific / 3-4pm Eastern
- **Standing biweekly** going forward

---

## Execution Update — v0.3.0 Browse Tool + Test Suite (2026-03-18)

### Observations

**O16: Media resources have non-sequential, unpredictable content IDs.**
FIAMaps articles use IDs like 368172, 869852 — spread across a huge range with no pattern. There is no way to scan or guess valid IDs. The only discovery path is reading the content files.
*Source: Direct observation of `BibleAquifer/FIAMaps/main/eng/json/001.content.json`*

**O17: Media article_metadata uses titles as index_reference, not BBCCCVVV ranges.**
For FIAMaps, `index_reference` values are strings like "abram's journey from ur to canaan" — correctly excluded from the passage index by `isValidIndexReference`. This is correct behavior (they're not passages) but it means passage search cannot discover them.
*Source: Direct observation of `BibleAquifer/FIAMaps/main/eng/metadata.json` article_metadata section*

**O18: Content files contain CDN image URLs in a consistent HTML format.**
Image articles have content like `<img src='https://cdn.aquifer.bible/aquifer-content/resources/FIAMaps/...' />`. The CDN URL pattern is stable and extractable via regex.
*Source: Direct observation of content file HTML fields*

**O19: FIAMaps metadata.json lists 22 content files in scripture_burrito.ingredients.**
The content file list is discoverable from metadata without scanning the filesystem. The existing `listContentFiles` function already extracts this.
*Source: Direct observation of metadata.json ingredients section*

**O20: All plumbing for browse already existed in the codebase.**
`getResourceMetadata`, `listContentFiles`, `fetchContentFile`, and `fetchJson` (with KV caching) were already implemented and working. The browse tool was an assembly task — wiring existing functions together with pagination — not new infrastructure.
*Source: Direct observation of `src/tools.ts` and `src/github.ts`*

**O21: The codebase had zero test coverage prior to v0.3.0.**
Vitest was configured in `package.json` with `test` and `test:watch` scripts, but no test files existed. The `references.ts` module (pure functions) and all 5 tool handlers were untested.
*Source: `glob **/*.test.ts` returned no results before this session*

### Learnings

**L10: The browse tool validates the existing plumbing architecture.**
Every function the browse handler needed was already available. `buildCatalog` simply wires `listContentFiles` → `fetchContentFile` → extract lightweight entries → cache in KV. Zero new GitHub fetching logic required. This confirms the separation between content plumbing and tool-level formatting was correct.
*Rests on: O20*

**L11: Media resources were a genuine dead end in the tool surface.**
The 4 existing tools (list, search, get, related) provide no API path from "I know FIAMaps exists" to "show me its 206 articles." list returns resource-level metadata only. search requires knowing what to search for. get requires knowing the content_id. related requires an existing article. Browse closes this loop.
*Rests on: O16, O17*

**L12: Mocking strategy for Workers KV is straightforward.**
A `Map<string, string>`-backed mock with `get`/`put`/`delete`/`list` stubs provides full test coverage for the caching layer. Combined with `vi.mock` for `registry.ts` and `github.ts`, all 5 tool handlers are testable in isolation without network access.
*Rests on: O21*

### Decisions

**D14: Add a `browse` tool that returns paginated article catalogs.**
*Because* the 4 existing tools create a complete discovery dead-end for media resources — no API path from "I know a resource exists" to "show me its articles" without already knowing content IDs.
*Alternatives rejected:* (1) Extend search to enumerate — violates search's query-based semantic contract. (2) Extend list to include articles — list is resource-level; thousands of articles would overwhelm it. (3) Wait for Aquifer API — viable long-term but blocks clients indefinitely.
*Rests on: O16, O17, O19, O20*
*Reversible: Yes — can be removed or replaced when the Aquifer API adds native browse*

**D15: Add test suite covering all tools and reference parsing.**
*Because* v0.3.0 adds a 5th tool and the codebase had zero test coverage. 51 tests cover: `parseReference` (9), `isValidIndexReference` (4), `rangesOverlap` (5), `bbcccvvvToReadable` (3), `rangeToReadable` (3), `handleList` (4), `handleSearch` (6), `handleGet` (4), `handleRelated` (2), `handleBrowse` (10).
*Rests on: O21*

### Constraints

**C10 (new): Browse catalog size vs. KV value limits.**
Workers KV values are limited to 25 MB. Media catalogs (~200 articles) are ~50-100 KB — safe. Large text resources (70K+ articles like UWTranslationNotes) could approach limits. Monitor; switch to per-file caching if needed.
*Status: Active — monitor during execution*

**C11 (new): Browse is a temporary bridge.**
The tool fetches from GitHub because the Aquifer API has no article enumeration endpoint. When the API adds one, update the backend data source. The tool surface (parameters, response format) should remain stable.
*Status: Active — boundary condition*

**C12 (new): Parallel content file fetches are bounded by resource size.**
FIAMaps has 22 content files — manageable. Resources with hundreds of files could hit Worker CPU limits on cold cache. Use `Promise.allSettled` and return partial catalogs on failure.
*Status: Active — design constraint*
