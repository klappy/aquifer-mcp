---
uri: aquifer://odd/ledger/journal
title: "aquifer-mcp Project Journal"
scope: aquifer-mcp
type: epistemic-ledger
derives_from: "docs/aquifer-mcp-oldc.md"
date_created: 2026-03-16
last_updated: 2026-03-16
---

# aquifer-mcp — Project Journal

> Durable artifacts from the aquifer-mcp build. This is the epistemic ledger for the project — observations, learnings, decisions, and constraints that survived challenge and earned their place. The planning-phase OLDC lives in `docs/aquifer-mcp-oldc.md`; this journal extends it with execution-phase entries.

---

## Observations

**O1: Aquifer metadata.json contains everything needed for the passage index.**
The `article_metadata` section in each repo's `metadata.json` provides `content_id`, `reference_id`, `index_reference` (BBCCCVVV range), and `localizations` per article — all without fetching content files. For BiblicaStudyNotes alone, 751 articles are indexed from metadata. This is the key insight that makes the thin proxy possible: you don't need content files to build a navigability index.
*Source: Direct observation of `samples/BiblicaStudyNotes-eng-metadata.json`, line 2385+*

**O2: article_metadata is a keyed object, not an array.**
The metadata uses `content_id` as the key in a flat object (`"132527": { "content_id": "132527", ... }`), not an array. The registry loader iterates `Object.entries()` to build the passage index.
*Source: Direct observation of sample data*

**O3: English titles are nested under localizations, not at the article_metadata top level.**
Individual article entries in `article_metadata` do not have a top-level `title` field. Titles are inside `localizations.eng.title` (or whichever language). The loader must reach into localizations to get a human-readable title, with a fallback to `Article {content_id}`.
*Source: Direct observation — metadata lines 2386-2442*

**O4: BiblicaStudyNotes-metadata.json and BiblicaStudyNotes-eng-metadata.json were byte-identical duplicates.**
The tar file contained both files (773KB each, MD5 `9b894b51`). Removed the non-eng version. Likely an artifact of the fetch process.
*Source: `md5` comparison*

**O5: Real sample data contains all three association types.**
The Romans content file (`BiblicaStudyNotes-eng-45-romans.json`) has 27 articles, each with `passage` (BBCCCVVV refs), `resource` (cross-resource links to BiblicaStudyNotesKeyTerms), and `acai` (entity annotations like `deity:Lord`, `keyterm:Justification`, `person:Jesus.2` with confidence scores and match methods). All 27 articles have ACAI data.
*Source: grep count — 27 `"acai"` matches in the file*

**O6: First index build fetches 17 repos in parallel and takes ~7.5 seconds.**
The registry loader uses `Promise.allSettled` to fetch all metadata.json files concurrently. First call: 7,472ms. Subsequent calls from KV cache: 350-460ms. The cold-start cost is acceptable for a daily-TTL cache.
*Source: curl timing from `wrangler dev`*

**O7: The passage index naturally spans resources.**
A single query for `ROM 3:24` returns articles from BiblicaStudyNotes, AquiferOpenStudyNotes, UWTranslationQuestions, and UWOpenBibleStories — four different resource types, without any cross-resource joining logic. The flat passage index handles it because every resource contributes to the same BBCCCVVV keyspace.
*Source: search("ROM 3:24") output — 5 articles from 4 resources*

**O8: The reference implementation (translation-helps-mcp) is significantly more complex than needed.**
It uses SvelteKit + adapter-cloudflare (Pages), Door43/Gitea with ZIP extraction, R2 for ZIP persistence, AI Search/BM25 for full-text search, and a full web UI. The Aquifer server needs none of this — pure Worker, GitHub raw URLs, KV cache. The reference was useful for the MCP protocol patterns (ToolContracts, UnifiedMCPHandler) but the content pipeline is irrelevant.
*Source: Architectural analysis of reference codebase*

**O9: oddkit's governance pattern maps directly to how Rick's docs should control the server.**
oddkit fetches canon from a baseline repo, caches by commit SHA, and uses it at runtime to shape tool behavior. The Aquifer server does the same with `BibleAquifer/docs` — schemas and metadata docs govern how resources are interpreted, indexed, and served. Content-addressed caching (SHA-keyed) prevents stale governance without polling.
*Source: Analysis of oddkit's `ensureBaselineRepo.js`, `buildIndex.js`, `docFetch.js`*

**O10: TruthKit's Navigate operation maps directly to the MCP tool surface.**
`list` = read the manifest (what exists), `search` = read summaries (references first, not content), `get` = full depth (complete article), `related` = follow crosslinks. The progressive disclosure pattern is already present: search returns lightweight refs, get returns full content — the consumer decides depth.
*Source: Comparison of `truthkit-skill-navigate.md` against implemented tool surface*

---

## Learnings

**L1: The OLDC from planning survived execution intact.**
Every decision from `docs/aquifer-mcp-oldc.md` (D1-D5) was implementable as specified. No decision required revision during execution. The constraints (C1-C6) were testable and met. This validates the planning session's output quality.
*Rests on: O6, O7, and all tool test results*

**L2: Metadata-only indexing is sufficient for the passage index.**
The `index_reference` field in `article_metadata` provides BBCCCVVV ranges without needing content files. For canonical resources, this is complete. For alphabetical/monograph resources, `index_reference` may be absent (these resources don't map to verse ranges). The index is naturally passage-complete for the resources that matter most.
*Rests on: O1, O7*

**L3: Entity index must build incrementally.**
ACAI associations exist only in content files, not in metadata. The entity index starts empty and populates as articles are fetched via `get`. This means first-time entity searches return sparse results. Acceptable for v0.1 — the passage index is the primary navigation path.
*Rests on: O5, absence of ACAI data in metadata.json*

**L4: The MCP protocol is simple enough to implement without the SDK.**
The JSON-RPC protocol for MCP has 5 methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. Implementing this directly avoids the `@modelcontextprotocol/sdk` dependency and any Node.js compatibility issues in the Workers runtime. Total protocol code: ~60 lines.
*Rests on: O8, reference implementation analysis*

**L5: Three reference implementations serve different purposes and all were needed.**
translation-helps-mcp showed the plumbing (how to proxy Bible resources). oddkit showed the governance (how docs control behavior). TruthKit showed the destination (progressive disclosure, typed crosslinks). Studying only one or two would have produced a less coherent architecture.
*Rests on: O8, O9, O10*

**L6: Range overlap is the correct passage matching strategy.**
Articles cover verse ranges (e.g., `45003021-45003031` for Romans 3:21-31). A query for `45003024` (Romans 3:24) must check overlap, not equality. String comparison works for BBCCCVVV because the format is zero-padded and lexicographically ordered.
*Rests on: O1, search results showing range-matching articles*

**L7: The article compound key (resource_code + language + content_id) works as designed.**
Content IDs are unique within a language version of a resource, confirmed by the data. The `get` tool resolves an article by first finding its `index_reference` in the passage index (to determine which content file to fetch), then fetching the file and filtering by `content_id`. No collisions observed.
*Rests on: O2, O5, get tool test results*

---

## Decisions

**D1: Pure Cloudflare Worker, not Pages.**
*Because* the server has no UI, no static assets, and no routing beyond `/mcp` and `/health`. Pages + SvelteKit (as used by translation-helps-mcp) adds unnecessary complexity. A single Worker with a `fetch` handler is the simplest thing that works.
*Alternatives considered: Cloudflare Pages + adapter-cloudflare (reference pattern), standalone Node.js MCP stdio server*
*Reversible: Yes — could wrap in SvelteKit later if a UI is needed*

**D2: Custom MCP HTTP bridge, not SDK transport.**
*Because* the `@modelcontextprotocol/sdk`'s HTTP transport targets Node.js `http.IncomingMessage`/`http.ServerResponse`, not Workers' `Request`/`Response`. Writing the JSON-RPC handler directly is ~60 lines and eliminates a dependency with unknown Workers compatibility.
*Alternatives considered: `@modelcontextprotocol/sdk` with `StreamableHTTPServerTransport`, SDK types-only import*
*Reversible: Yes — could adopt SDK later if it adds Workers support*

**D3: Known repos hardcoded, not discovered from GitHub API.**
*Because* the GitHub org API requires authentication for reliable listing, and the set of repos changes infrequently. The `KNOWN_REPOS` array in `registry.ts` lists 17 non-Bible repos with their ordering schemes. When Rick adds a repo, the array gets updated.
*Alternatives considered: GitHub API `GET /orgs/BibleAquifer/repos`, governance doc listing*
*Constraint created: Adding a new resource requires a code change (update KNOWN_REPOS)*
*Reversible: Yes — could add dynamic discovery later*

**D4: Daily TTL caching, not content-addressed (SHA-keyed) for v0.1.**
*Because* Workers KV supports TTL-based expiration natively. Content-addressed caching (oddkit's pattern) requires an API call to check the commit SHA on every request. Daily TTL is simpler and sufficient — Rick doesn't update hourly.
*Alternatives considered: SHA-keyed caching per oddkit pattern, no caching*
*Constraint: Stale index possible for up to 24 hours after Rick updates*
*Reversible: Yes — governance SHA fetch is already implemented in `github.ts`, just not wired to cache invalidation*

**D5: Article titles fall back to content_id, not to empty string.**
*Because* the `article_metadata` section stores titles under `localizations.{lang}.title`, and not all entries have an `eng` localization. Falling back to `Article {content_id}` keeps search results informative even when title data is missing.
*Rests on: O3*

**D6: Content file resolution uses index_reference for canonical, guesses for alphabetical.**
*Because* canonical resources use `NN.content.json` where NN is the book number, directly derivable from the first two characters of `index_reference`. Alphabetical resources use `NNNNNN.content.json` with no obvious mapping from content_id — the server tries files sequentially (up to 10) as a fallback.
*Constraint: Alphabetical resource `get` may be slow on first fetch (up to 10 sequential fetches)*
*Reversible: Yes — could build a content_id-to-file mapping from metadata or cache results*

---

## Constraints

**C1: No new resources to manage.**
The server manages nothing beyond its own code and a KV cache. No repos, no databases, no stored knowledge bases. Enforced throughout.
*Status: Active, verified*

**C2: License preservation required.**
CC-BY and CC-BY-SA attribution from resource metadata must be surfaced when serving content. The `get` tool includes source attribution in its output.
*Status: Active — basic attribution implemented, full license display not yet surfaced*

**C3: BBCCCVVV is the location standard.**
All passage queries use Aquifer's verse reference format internally. Human-readable input (`Romans 3:24`, `ROM 3:24`) is parsed to BBCCCVVV before index lookup.
*Status: Active, verified*

**C4: Compound keys for articles.**
`resource_code + language + content_id` is used everywhere. Never assume content IDs are globally unique.
*Status: Active, verified*

**C5: Respect Rick's repo structure.**
The server reads from repos as Rick built them. Content URLs follow his directory layout (`{language}/json/{file}`). Metadata URLs follow his convention (`{language}/metadata.json`). No new organization imposed.
*Status: Active, verified*

**C6: Demo, not pitch.**
March 16 meeting is showing value through a working system. The output speaks for itself.
*Status: Active — v0.1 demo-ready on wrangler dev*

**C7: KV namespace IDs are placeholders until production deploy.**
The `wrangler.toml` has placeholder IDs for the `AQUIFER_CACHE` KV namespace. Must run `wrangler kv:namespace create` before deploying to Cloudflare.
*Status: Active — blocks production deploy, does not block local dev*

**C8: Entity index sparse until content fetched.**
ACAI associations live in content files only. The entity index builds incrementally as articles are fetched via `get`. First entity searches will return incomplete results.
*Status: Active — by design, documented as a known limitation*

---

## Handoff: v0.1 to v0.2

**What was built**: aquifer-mcp v0.1 — a Cloudflare Worker MCP server with 4 tools (list, search, get, related), passage index from 17 Aquifer repos, MCP JSON-RPC over HTTP, Workers KV caching.

**What works**: All 4 tools verified against live Aquifer repos. Passage search returns cross-resource results. Article fetch returns full content with associations. Related tool traverses passage overlap and resource links.

**What's next** (in priority order):
1. Create KV namespaces and deploy to Cloudflare (`wrangler kv:namespace create AQUIFER_CACHE`)
2. Test against full 48-repo set (including Bible repos and potentially private Tyndale repos)
3. Build entity index incrementally from fetched content (wire ACAI data from `get` responses back into the entity index)
4. Add governance SHA-based cache invalidation (oddkit pattern — already partially implemented)
5. Add Tyndale resource handling (may require auth or different access patterns)

**Definition of done for v0.2**: Entity search (`search("keyterm:Justification")`) returns results across resources. Deploy running on Cloudflare (not just wrangler dev). All Bible repos indexed.

**Active constraints**: C1-C8 above.

---

## Execution Update — Bug-Fix Cycle (2026-03-16)

### Observations

**O11: get failures on alphabetical and monograph resources were caused by file-guess limits.**
`findArticle()` depended on a fallback that only probed `000001.content.json` through `000010.content.json`. This failed for valid content IDs stored in files beyond 10 (for example, OBS story files and large alphabetical resources).
*Source: direct code observation in `src/tools.ts` and local runtime verification*

**O12: keyword search blind spot came from searching only passage-indexed refs.**
`searchByTitle()` iterated over `index.passage.values()`, which excluded many alphabetical resources and weakly represented non-canonical article titles.
*Source: direct code observation and runtime checks*

**O13: metadata for alphabetical resources often stores searchable terms in non-BBCCCVVV index_reference values.**
For resources like Biblica key terms, article metadata had entries like `gospel`, `joseph of nazareth`, and `judea` in `index_reference`, while explicit `title` fields were absent.
*Source: direct observation of live metadata fetched from GitHub raw*

### Learnings

**L10: file resolution must be metadata-driven, not heuristic-bounded.**
For non-canonical resources, Scripture Burrito ingredient listings are the most reliable source of actual content file paths. Probing arbitrary low file numbers is brittle.
*Rests on: O11*

**L11: title indexing and passage indexing serve different intents and must stay separate.**
Passage index should remain BBCCCVVV-valid only. Title search should use an all-resource title corpus with sensible fallback titles.
*Rests on: O12, O13*

### Decisions

**D7: replace fixed 1-10 file guessing with metadata-discovered file traversal.**
*Because* resource file layouts are discoverable from metadata (`scripture_burrito.ingredients`) and may exceed small ranges.
*Alternatives considered: widen fixed range probes, GitHub API directory listing*
*Reversible: Yes — can be replaced by precomputed content_id->file maps later*

**D8: add a dedicated title index for all resources and fallback to non-range index_reference when title is missing.**
*Because* keyword search should be discoverability-first and many dictionary-style resources do not provide explicit title fields in metadata.
*Alternatives considered: index only canonical resources, content-level full-text indexing*
*Constraint created: title relevance is metadata-dependent and not full-text semantic search*
*Reversible: Yes — can evolve to richer ranking later*

**D9: validate passage ranges before indexing and overlap checks.**
*Because* non-BBCCCVVV values should never participate in passage overlap logic.
*Alternatives considered: permissive indexing with runtime filters*
*Reversible: Yes*

**D10: bootstrap entity search on cold start by scanning content files for the requested entity ID, then cache hits.**
*Because* ACAI entity data is in content files and an empty cold index created dead-end behavior.
*Alternatives considered: keep incremental-only entity index, precompute full entity index at startup*
*Constraint created: first query for unseen entities can be slower*
*Reversible: Yes — can move to scheduled precomputation if needed*

### Constraint Updates

**C8 update: entity search is no longer strictly sparse by design.**
Entity results now bootstrap on demand for the queried entity and are cached. Cold-start completeness improved, while first-hit latency remains a tradeoff.
*Status: Active with mitigation implemented*
