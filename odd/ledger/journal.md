---
uri: aquifer://odd/ledger/journal
title: "aquifer-mcp Project Journal"
scope: aquifer-mcp
type: epistemic-ledger
derives_from: "docs/aquifer-mcp-oldc.md"
date_created: 2026-03-16
last_updated: 2026-03-19
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

---

## Execution Update — Cloudflare MCP SDK Migration (2026-03-17)

### Observations

**O14: The hand-rolled JSON-RPC handler works for curl but is invisible to MCP clients.**
The v0.1.x server responds correctly to `tools/list`, `tools/call`, `initialize`, etc. via plain JSON over POST. But Claude.ai custom connectors, Claude Desktop, Cursor, VS Code, and the official `@modelcontextprotocol/sdk` client all expect Streamable HTTP transport (SSE-based). The custom handler returns `application/json` where clients expect `text/event-stream`. Result: the server works perfectly for direct API calls but cannot be connected as an MCP server by any standard client.
*Source: Direct testing — Claude.ai connector rejected the URL; PRD verification against MCP transport spec*

**O15: Cloudflare's `agents` package (v0.7.6) exports `createMcpHandler` from `agents/mcp`.**
The function accepts a `McpServer` instance and returns a standard `(request, env, ctx) => Promise<Response>` fetch handler. It handles Streamable HTTP transport, SSE, session management, and CORS automatically. No Durable Objects required — it works as a stateless handler in a plain Worker.
*Source: Direct observation of `node_modules/agents/dist/mcp/index.d.ts` and `index-WBy5hmm3.d.ts`*

**O16: The `agents` package bundles `@modelcontextprotocol/sdk@1.26.0` internally.**
Installing `@modelcontextprotocol/sdk` separately at a different version (1.27.1) causes TypeScript errors due to private property incompatibility between the two `McpServer` class declarations. Pinning to 1.26.0 resolves the conflict.
*Source: TypeScript error `TS2345` observed and resolved by version pinning*

**O17: The existing tool handlers already return MCP-standard format.**
All four handlers (`handleList`, `handleSearch`, `handleGet`, `handleRelated`) return `{ content: [{ type: "text", text: "..." }] }` which is the exact `CallToolResult` shape expected by `McpServer.tool()` callbacks. Zero handler changes needed.
*Source: Direct code observation of `src/tools.ts`*

**O18: The migration touches exactly two files.**
`src/index.ts` — complete rewrite (129 lines → 82 lines). `src/tools.ts` — removal of `TOOL_DEFINITIONS` export (64 lines removed, zero handler lines changed). All other source files untouched: `registry.ts`, `github.ts`, `references.ts`, `types.ts`, `wrangler.toml`.
*Source: Direct implementation observation*

### Learnings

**L12: Transport and tool logic are cleanly separable.**
The v0.1.x architecture already had a clean boundary: `index.ts` handled JSON-RPC routing, `tools.ts` handled tool logic. This made the migration a pure transport swap. The lesson validates the original architecture decision to keep protocol handling in `index.ts` and tool logic in `tools.ts`.
*Rests on: O17, O18*

**L13: SDK version alignment is critical when using wrapper packages.**
The `agents` package bundles its own copy of `@modelcontextprotocol/sdk`. Installing a different version as a top-level dependency creates type conflicts because TypeScript treats private properties as nominal (not structural). The fix: pin the top-level dependency to match the bundled version.
*Rests on: O16*

**L14: D2 (custom MCP bridge) was correctly reversible as claimed.**
The original journal entry for D2 stated "Reversible: Yes — could adopt SDK later if it adds Workers support." The Cloudflare Agents SDK now provides that Workers support via `createMcpHandler`. The reversal was clean and took ~30 minutes. This validates the project's practice of marking decisions as reversible.
*Rests on: O15, D2 from original journal*

### Decisions

**D11: Adopt `createMcpHandler` from Cloudflare Agents SDK, reversing D2.**
*Because* the Agents SDK now provides a stateless `createMcpHandler` that works in plain Workers without Durable Objects, eliminating the original concern about Workers compatibility. Standard transport means every MCP client can connect.
*Alternatives considered: Keep custom JSON-RPC and add SSE manually, use `@modelcontextprotocol/sdk` StreamableHTTPServerTransport directly*
*D2 status: Superseded by D11*
*Reversible: Yes — could revert to custom handler if SDK introduces breaking changes*

**D12: Pin `@modelcontextprotocol/sdk` to match `agents` bundled version (1.26.0).**
*Because* version mismatch causes TypeScript errors from incompatible private property declarations across duplicate class definitions.
*Constraint created: Must update both packages together when upgrading*
*Reversible: Yes — when agents upgrades its bundled SDK, we upgrade ours*

**D13: Create fresh McpServer instance per request.**
*Because* MCP SDK 1.26.0+ enforces single-transport-per-server. Reusing a global server instance would leak responses across clients. Per-request instantiation is the documented pattern for stateless Workers.
*Rests on: O15*
*Reversible: No — this is a security requirement, not a preference*

### Constraint Updates

**D2 update: superseded by D11.**
Custom JSON-RPC bridge replaced by Cloudflare Agents SDK `createMcpHandler`. The tool logic boundary was clean enough that the migration required zero handler changes.
*Status: Superseded*

**C7 update: KV namespaces are no longer placeholders.**
Production deployment completed prior to this migration. KV namespace IDs in `wrangler.toml` are live.
*Status: Resolved*

**C9 (new): SDK version coupling.**
The `agents` package and `@modelcontextprotocol/sdk` must be version-aligned. Upgrading either independently can break TypeScript compilation.
*Status: Active*

---

## v0.3.0 Planning — Browse Tool (2026-03-17)

### Observations

**O19: Media resources have non-sequential, unpredictable content IDs.**
FIAMaps articles use IDs like 368172, 869852 — spread across a huge range with no pattern. There is no way to scan or guess valid IDs. The only discovery path is reading the content files.
*Source: Direct observation of `BibleAquifer/FIAMaps/main/eng/json/001.content.json`*

**O20: Media article_metadata uses titles as index_reference, not BBCCCVVV ranges.**
For FIAMaps, `index_reference` values are strings like "abram's journey from ur to canaan" — correctly excluded from the passage index by `isValidIndexReference`. This is correct behavior (they're not passages) but it means passage search cannot discover them.
*Source: Direct observation of `BibleAquifer/FIAMaps/main/eng/metadata.json` article_metadata section*

**O21: Content files contain CDN image URLs in a consistent HTML format.**
Image articles have content like `<img src='https://cdn.aquifer.bible/aquifer-content/resources/FIAMaps/...' />`. The CDN URL pattern is stable and extractable via regex.
*Source: Direct observation of `BibleAquifer/FIAMaps/main/eng/json/001.content.json` content fields*

**O22: FIAMaps metadata.json lists 22 content files in scripture_burrito.ingredients.**
The content file list is discoverable from metadata without scanning the filesystem. The existing `listContentFiles` function already extracts this. For FIAMaps, files range from `json/001.content.json` to `json/022.content.json`.
*Source: Direct observation of metadata.json ingredients section*

**O23: All plumbing for browse already exists in the codebase.**
`getResourceMetadata`, `listContentFiles`, `fetchContentFile`, and `fetchJson` (with KV caching) are already implemented and working. The browse tool is an assembly task — wiring existing functions together with pagination — not new infrastructure.
*Source: Direct observation of `src/tools.ts` lines 289-307, `src/github.ts`*

### Decisions

**D14: Add a `browse` tool that returns paginated article catalogs.**
*Because* the 4 existing tools create a complete discovery dead-end for media resources — no API path from "I know a resource exists" to "show me its articles" without already knowing content IDs.
*Alternatives rejected:* (1) Extend search to enumerate — violates search's query-based semantic contract. (2) Extend list to include articles — list is resource-level; thousands of articles would overwhelm it. (3) Wait for Aquifer API — viable long-term but blocks clients indefinitely.
*Rests on: O19, O20, O22, O23*
*Reversible: Yes — can be removed or replaced when the Aquifer API adds native browse*

### Constraints

**C10 (new): Browse catalog size vs. KV value limits.**
KV values are limited to 25 MB. Media catalogs (~200 articles) are ~50-100 KB — safe. Large text resources (70K+ articles like UWTranslationNotes) could approach limits. Monitor; switch to per-file caching if needed.
*Status: Active — monitor during execution*

**C11 (new): Browse is a temporary bridge.**
The tool fetches from GitHub because the Aquifer API has no article enumeration endpoint. When the API adds one, update the backend data source. The tool surface (parameters, response format) should remain stable.
*Status: Active — boundary condition*

**C12 (new): Parallel content file fetches are bounded by resource size.**
FIAMaps has 22 content files — manageable. Resources with hundreds of files could hit Worker CPU limits on cold cache. Use `Promise.allSettled` and return partial catalogs on failure.
*Status: Active — design constraint*

---

## Execution Update — Telemetry OLDC Reset (2026-03-19)

### Observations

**O24: Telemetry and leaderboard features were implemented before full OLDC challenge/preflight sequence was completed.**
Implementation was completed quickly and validated technically (build/tests), but epistemic sequencing was compressed for a governance-facing change.
*Source: direct process observation during this telemetry cycle*

### Learnings

**L15: Public telemetry changes must be treated as trust-boundary changes, not routine feature work.**
Because telemetry policy defines what user-adjacent signals are captured and exposed, it requires explicit challenge and preflight before acceptance.
*Rests on: O24*

### Decisions

**D15: Preserve the current telemetry implementation as a candidate artifact and re-evaluate it through OLDC-first flow before accepting it as final.**
*Because* premature convergence in telemetry design can encode weak assumptions and reduce epistemic integrity.
*Alternatives considered:* (A) keep implementation as-is without formal re-evaluation, (B) revert all telemetry code and restart immediately, (C) treat current build as unvalidated candidate pending plan/challenge/preflight review.
*Chosen:* C
*Reversible:* Code path reversible; process rule permanent for this project.

### Constraints

**C13 (new): Anonymity-by-default telemetry boundary.**
Telemetry must maximize aggregate operational transparency while excluding identity and raw content by default. Opt-in debug capture, if ever used, must be explicit and time-limited.
*Status: Active*

### Handoff

Produce a plan-first telemetry packet (scope, insertion points, alternatives), challenge it adversarially, run preflight checks, compare against current implementation, then decide steer/pivot and rebuild if required.

---

## Execution Update — Public Telemetry Incentives (2026-03-19)

### Observations

**O25: KV-only aggregate counters are simple but brittle under concurrent increments and eventual consistency.**
The telemetry path currently uses read-modify-write counter updates in Workers KV. This is lightweight and sufficient for basic visibility, but it can lose increments under high concurrency and produce temporarily stale leaderboard ordering.
*Source: direct code observation in `src/telemetry.ts` and architecture review during telemetry challenge pass*

**O26: Product direction requires mandatory baseline tracking plus optional honor-system richness.**
The explicit requirement is that all tool usage must be tracked automatically, while non-verified details remain honor-system and are incentivized rather than enforced.
*Source: direct requirement during telemetry design conversation*

### Learnings

**L16: Incentives work best when they are additive, not blocking.**
Making baseline telemetry automatic preserves usage truth; adding transparency scoring and badges encourages richer self-report without degrading usability or introducing hard gates.
*Rests on: O26*

**L17: Public leaderboards need provenance signals, not just rank values.**
Leaderboard trust improves when source and verification class are visible (`x-aquifer-client`, initialize clientInfo, user-agent, verified/unverified), even if details are honor-system.
*Rests on: O25, O26*

### Decisions

**D16: Enforce automatic tracking for all `tools/call` usage in the server path.**
*Because* usage truth cannot depend on optional client participation.
*Alternatives considered:* optional-only telemetry, opt-in telemetry, and client-side-only reporting.
*Reversible:* No (policy-level requirement), though implementation details are reversible.

**D17: Add weighted usage ranking where verified clients score 10x per tool call.**
*Because* verified identity should receive stronger leaderboard trust and recognition.
*Alternatives considered:* no weighting, 2x/5x weighting, strict verification-only leaderboard.
*Chosen:* 10x weighted + non-blocking open leaderboard.
*Reversible:* Yes — multiplier remains a policy knob.

**D18: Add a transparency leaderboard scored by self-report completeness with badges.**
*Because* richer self-reported metadata is valuable but should be encouraged by incentives rather than enforced by request rejection.
*Alternatives considered:* hard required metadata, no transparency ranking, private-only scoring.
*Reversible:* Yes — scoring fields and badge thresholds are tunable.

### Constraints

**C14 (new): Mandatory baseline telemetry, optional enrichment.**
All `tools/call` traffic must be tracked automatically. Additional self-report metadata remains optional and honor-system unless independently verified.
*Status: Active*

**C15 (new): Transparency incentives must remain non-blocking.**
No request path may fail due to missing self-report fields. Missing detail affects ranking only.
*Status: Active*

### Handoff

Monitor leaderboard gaming and counter drift behavior. If usage scale makes KV increment fragility observable, migrate telemetry writes to a Durable Object aggregator while preserving public tool contracts (`telemetry_policy`, `telemetry_public`).

---

## Execution Update — Branch and testable deploys (2026-03-19)

### Observations

**O27: Single-environment Wrangler config made pre-production Cloudflare testing implicit rather than explicit.**
Without a named staging Worker, the only deploy target was production-shaped defaults.
*Source: `wrangler.toml` prior to `[env.staging]` addition*

### Decisions

**D19: Add `staging` Wrangler environment (`aquifer-mcp-staging`) bound to preview KV for testable deploys.**
*Because* staging should exercise real Workers + KV without writing telemetry or cache into production KV.
*Alternatives considered:* duplicate KV namespace (documented upgrade path), workers.dev only local dev.
*Reversible:* Yes — swap staging KV id when dedicated namespace is created.

**D20: Document branch strategy and add GitHub Actions CI + optional deploy workflows.** *(Superseded by D21 — deploy workflows removed; Cloudflare Git integration is the deploy path.)*
*Because* PRs should always run build/test; `staging`/`main` pushes can deploy when secrets exist, matching Claude-style testable deployment loops.
*Reversible:* Yes — workflows can be narrowed to `workflow_dispatch` only.

### Handoff

Deploy path: Cloudflare dashboard Git integration (D21). CI in GitHub: build + test only; no deploy secrets on the repo for that.

---

## Execution Update — Deploy source of truth: Cloudflare Git (2026-03-19)

### Observations

**O28: GitHub Actions Wrangler deploy duplicated (and contradicted) Cloudflare dashboard Git integration.**  
The account already deploys on push via Cloudflare’s connected repo; separate `deploy-*.yml` workflows implied secrets and a second deploy path.

### Decisions

**D21: Remove GitHub Actions deploy workflows; document Cloudflare Git integration as the deploy mechanism.**  
*Because* one deploy pipeline avoids confusion and matches how the Worker is actually released.  
*Reversible:* Yes — re-add workflows if a fork wants Actions-only deploy.

### Handoff

`ci.yml` remains (build + test). Default deploy is one Worker from Cloudflare Git; git branch `staging` is not a second deploy path unless explicitly configured outside repo docs.

---

## Execution Update — Git `staging` is not Cloudflare staging deploy (2026-03-19)

### Observations

**O29: Docs implied pushing branch `staging` or using `--env staging` matched “test staging in Cloudflare.”**  
In this setup, **only the default Worker** is deployed from Git integration; the `staging` branch is for integration/CI, not a separate published staging Worker.

### Decisions

**D22: Align README, DEPLOY-SETUP, branch strategy, and `wrangler.toml` comments with single-Worker deploy; demote `[env.staging]` to optional local/maintainer Wrangler use.**

### Handoff

Do not tell contributors to “deploy staging” via Cloudflare for routine releases.

---

## Execution Update — Preview hostnames `*-aquifer-mcp.klappy.workers.dev` (2026-03-19)

### Observations

**O30: Cloudflare Workers Git previews use `…-aquifer-mcp.klappy.workers.dev`, not `aquifer-mcp-staging.klappy.workers.dev`.**  
Prior docs assumed a separate worker hostname pattern that did not match the account’s preview URL shape.

### Decisions

**D23: Document preview URL pattern and dashboard as source of truth for the full hostname; distinguish Git previews from Wrangler `[env.staging]`.**

**O31: For this account, git branch `staging` preview host is `staging-aquifer-mcp.klappy.workers.dev` (pattern `<branch-slug>-aquifer-mcp.klappy.workers.dev`).** Verified `GET /health` returns `0.6.0`.

---

## OLDC — oddkit `encode` record (2026-03-19)

**Tool:** `oddkit_encode` · **encode status:** `ENCODED` · **artifact status:** `draft` · **quality:** weak (2/5) · **tool timestamp:** `2026-03-19T19:51:48.100Z`

**Artifact type:** decision  

**Decision (artifact body, verbatim):**  
Aquifer MCP (`klappy/aquifer-mcp`): (1) Cloudflare Git preview hostnames follow `<branch-slug>-aquifer-mcp.klappy.workers.dev`; git branch `staging` maps to `staging-aquifer-mcp.klappy.workers.dev`. (2) GitHub Actions CI `push` trigger limited to `main` only (Cursor Agent) to stop duplicate CI on PR `synchronize`; `pull_request` still runs CI for all branches. (3) `main` branch protected: required PR, strict status check `CI / build-test`, no force-push or deletion, 0 required approvals. (4) Telemetry on staging verified: KV totals, method counts, consumer leaderboards, label sources (`x-aquifer-client`, `initialize.clientInfo.name`, `user-agent`). (5) Docs: `DEPLOY-SETUP.md`, `docs/branch-and-deployment-strategy.md` (branch-protection guide may land via follow-up PR). **Tradeoff:** pushes to `staging` without a PR no longer trigger GitHub CI from the `push` event.

**Rationale (ledger strengthening — oddkit gap: none in raw encode):**  
*Because* overlapping `push` + `pull_request` workflows duplicated CI signal and cost; *because* `main` is production lineage and must require a PR plus green `CI / build-test` (strict) before merge; *because* preview hostnames must match observed Cloudflare Workers Git behavior so pre-prod testing hits the correct edge; *because* telemetry aggregates were exercised on `staging` before trusting public leaderboard semantics.

**Constraints (from encode + ops):**  
- `main`: PR required, strict `CI / build-test`, no force-push / deletion (approvals: 0 for solo merge after green CI).

**Alternatives considered:**  
- CI: `concurrency` / `paths-ignore` instead of `push: [main]` — heavier to tune; branch-scoped push list (`main`, `staging`) possible if staging-push CI is required again.  
- Branch protection: require ≥1 approval — deferred for solo maintainer velocity; enable when second reviewer exists.

**Reversibility:** GitHub branch protection and workflow triggers are dashboard/API-editable; preview hostname docs are documentation-only; telemetry KV keys remain purgeable via TTL/policy.

**oddkit quality gaps (original pass):** missing explicit rationale; suggestions were add rationale, alternatives, reversibility — addressed in this ledger block.

---

## Execution Update — PR merge path, CI dedup, governance encode closure (2026-03-19)

### Observations

**O32: Integration work reached `main` via PR merge (`#6`); `staging` fast-forwarded to include Cursor Agent CI change (`push` → `main` only).**

**O33: oddkit `encode` on the bundled items scored weak until rationale, alternatives, and reversibility were anchored here (OLDC append).**

### Decisions

**D25: Record the bundled deploy/CI/telemetry/`main`-protection decisions as one durable governance closure in the project journal, with oddkit `encode` artifact referenced and ledger fields completed to meet epistemic debt on “why” and “undo”.**

### Handoff

If `ci.yml` **workflow `name`** or **job `id`** changes, update GitHub **required status checks** so `main` stays mergeable. For doc-only deltas (e.g. branch protection guide) not yet on `main`, ship via PR into `main` under the new protection rules.
