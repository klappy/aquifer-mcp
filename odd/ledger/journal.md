---
uri: aquifer://odd/ledger/journal
title: "aquifer-mcp Project Journal"
scope: aquifer-mcp
type: epistemic-ledger
derives_from: "docs/aquifer-mcp-oldc.md"
date_created: 2026-03-16
last_updated: 2026-03-20
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

---

## Execution Update — Light protection for `staging` (2026-03-19)

### Decisions

**D26: Apply GitHub branch protection on `staging` softer than `main`: disallow force-push and branch deletion; do not require PR or status checks** so integration can move quickly while keeping history and the branch itself safe.

### Handoff

Canonical comparison: `docs/github-branch-protection.md`. Tighten `staging` later (e.g. require PR or optional CI check) if the team wants more gatekeeping.

---

## Execution Update — Resource-Level Telemetry (2026-03-19)

### Observations

**O34: Existing telemetry tracked tool invocations but not what was being accessed.**
The v1 telemetry recorded which tools were called and by whom, but not which resources, languages, articles, or search patterns were being used. Knowing "someone called `get` 50 times" without knowing which resources or articles were fetched is like knowing people came into the restaurant without knowing what they ordered.
*Source: Direct observation of `src/telemetry.ts` — only `parseToolName` was extracted from payloads, not `params.arguments`*

**O35: Tool arguments contain structural identifiers safe for telemetry extraction.**
`resource_code`, `language`, `content_id` are structural keys present in `get`, `related`, and `browse` tool arguments. These are repository names and language codes, not user content or identity data. They fall outside the governance exclusion list (which covers raw queries, article content, identity).
*Source: Review of tool argument schemas in `src/index.ts` against excluded fields in telemetry governance doc*

**O36: Search queries can be classified by pattern without logging the raw text.**
Passage references match `digits:digits` or BBCCCVVV patterns. Entity queries match `type:label`. Everything else is title search. The classification reveals usage patterns (how many passage vs entity vs keyword searches) without storing the actual query content.
*Source: Analysis of `parseReference` patterns in `src/references.ts`*

### Learnings

**L18: Telemetry on structural identifiers reveals usage topology without privacy cost.**
Tracking which resources are popular, which languages are active, and which articles are fetched repeatedly gives operational visibility into what the Aquifer is actually used for — without any user-identifying or content-level data.
*Rests on: O34, O35*

**L19: Last-article tracking creates a real-time pulse of system activity.**
A single JSON record of the most recent article access (compound key + tool + timestamp) provides a heartbeat view that aggregate counters cannot — it shows what the system is doing right now, not just totals.
*Rests on: O34*

### Decisions

**D27: Extract resource_code, language, content_id, and search type from tool arguments in the telemetry recording path.**
*Because* resource-level visibility requires parsing `params.arguments` from the JSON-RPC body, which is already available in `recordPublicTelemetry`. This keeps all telemetry logic centralized rather than instrumenting individual handlers.
*Alternatives considered:* (A) instrument each handler with a telemetry callback, (B) parse arguments in a post-response hook. Chose centralized parsing for simplicity and consistency with existing pattern.
*Reversible:* Yes — new counters can be removed without affecting existing ones.

**D28: Bump schema version to telemetry-public-v2.**
*Because* the snapshot structure gained new leaderboards (resources, languages, articles), new fields (search_type_counts, last_article), and new tracked_field entries. Consumers should detect the version change.
*Reversible:* No — version should only move forward.

### Constraint Updates

**C14 update: Resource-level counters are structural identifiers, not content.**
`resource_code` (repo name), `language` (ISO code), `content_id` (article key), and search type (passage/entity/title) are all structural metadata. They do not violate the anonymity-by-default boundary.
*Status: Active, verified*

### New KV Key Patterns

- `telemetry:v1:{env}:resource:{resource_code}` — resource access counter
- `telemetry:v1:{env}:language:{language}` — language access counter
- `telemetry:v1:{env}:article:{resource_code}:{language}:{content_id}` — article access counter
- `telemetry:v1:{env}:search-type:{passage|entity|title}` — search type counter
- `telemetry:v1:{env}:last_article` — JSON record of last article accessed

---

## v0.8.0 — Dynamic Resource Discovery (2026-03-20)

*Execution mode. Replaces hardcoded resource list with GitHub org API discovery.*

### Observations

**O35: The hardcoded KNOWN_REPOS array covered 17 of 54 repos in the BibleAquifer org.**
37 resources were invisible to the server, including UWTranslationNotes (70,220 articles), SILOpenTranslatorsNotes, UWTranslationManual, VideoBibleDictionary, DictionaryBibleThemes, BiblicaOpenBibleMaps, multiple Bible repos, and several Tyndale/Aquifer study note variants.

**O36: UWTranslationNotes was in KNOWN_REPOS but silently failed because its 35 MB metadata.json exceeds KV's 25 MiB value limit.**
The `fetchJson` function threw on KV put, `Promise.allSettled` caught it, and the resource vanished from the registry with no error trace.

**O37: The GitHub org API returns all repos in a single page (54 repos, per_page=100) and supports ETag-based conditional requests where 304s do not consume rate limit.**

### Learnings

**L20: Hardcoded resource lists are the opposite of antifragile.**
Every new resource Rick publishes requires a code change, a PR, and a deploy. This creates a maintenance bottleneck that scales linearly with the org's growth rate. The governance pattern in CLAUDE.md already said "no code change required" — the code contradicted the spec.
*Rests on: O35*

**L21: Silent failure on KV size limits is a correctness bug, not a caching optimization.**
When a cache write failure kills the data return path, the system silently drops resources. The fix is trivial (try-catch the put) but the impact was total invisibility of a 70,220-article resource.
*Rests on: O36*

### Decisions

**D29: Replace KNOWN_REPOS with dynamic GitHub org API discovery.**
*Because* the hardcoded list contradicted the governance pattern, required manual maintenance, and missed 37 of 54 repos. The org API with ETag caching adds one API call per index build (free on 304) and discovers all repos automatically.
*Alternatives considered:* (A) Parse `aquifer_full_inventory.md` as the discovery source — rejected because Rick would still need to update it manually. (B) Keep KNOWN_REPOS but add missing entries — rejected because it perpetuates the maintenance burden.
*Reversible:* Yes — could re-add a static list as fallback if the org API becomes unreliable.

**D30: Wrap all KV puts in try-catch where the data can still be served from memory.**
*Because* KV has a 25 MiB value limit and several Aquifer resources produce metadata, indexes, or catalogs that exceed it. A failed cache write should not kill the request.
*Reversible:* No reason to reverse.

**D31: Bump index cache key to v6.**
*Because* the index composition changed (dynamic discovery yields different repos than the static list). Old cached indexes must not be reused.

### Constraint Updates

**C15: No hardcoded resource lists. All resource discovery must be dynamic.**
The server discovers resources from the GitHub org API at runtime. Resource type, ordering, and metadata come from each repo's own `metadata.json`. Adding a new resource requires only that it exist in the org with valid metadata.
*Status: Active, verified*

**C8 update (from D3): The constraint "Adding a new resource requires a code change" is retired.**
Replaced by C15. Discovery is now fully dynamic.
*Status: Retired, replaced by C15*

---

## Execution Update — Full Bible Reference Parsing (2026-03-20)

*Execution mode. Extends `parseReference` to handle all reference granularities — book-only, chapter-only, and chapter-range — in addition to the existing chapter:verse patterns.*

### Observations

**O38: `parseReference` only matched references containing a verse number, leaving chapter-only and book-only queries to fall through to fuzzy title search.**
Both regex paths in `parseReference` required `:(\d{1,3})` (colon + verse). Queries like "Mark 4", "Mark 4-6", or "Mark" returned `null` from `parseReference`, causing `handleSearch` to route them to `searchByTitle`. Title search then fuzzy-matched "mark" against article titles, returning false positives like FIAMaps entries with "mark" in the title and dictionary entry "market."
*Source: Direct observation of `src/references.ts` lines 69 and 90 (USFM and name regex patterns); confirmed by Aquifer Window search returning map titles and "market" for query "Mark 4"*

**O39: Sentinel BBCCCVVV values (999) pass existing validation and maintain correct boundaries under string comparison.**
`parseBBCCCVVV` validates that book exists in the lookup table and that chapter/verse are numbers — it does not enforce range limits. `rangesOverlap` uses string comparison (`<=`), and zero-padded BBCCCVVV is lexicographically ordered: `41004999` < `41005001` (chapter boundary safe), `41999999` < `42001001` (book boundary safe). Both confirmed with direct Node.js execution before implementation.
*Source: Pre-implementation string comparison proof — 6 assertions, all passed*

**O40: The search pipeline required zero changes to support the new reference formats.**
`handleSearch` calls `parseReference` → if non-null, calls `searchByPassage` → which calls `rangesOverlap` against the passage index. All three functions already handle BBCCCVVV ranges. The only change needed was making `parseReference` produce ranges for inputs it previously rejected.
*Source: Direct observation of `src/tools.ts` lines 289-329 — no edits required*

### Learnings

**L22: Sentinel values in a zero-padded positional format are safe for range overlap without needing actual verse/chapter counts.**
Because BBCCCVVV is lexicographically ordered by construction (BB then CCC then VVV, all zero-padded), using 999 as "all" for any positional field naturally respects boundaries. You don't need to know that Mark 4 has 41 verses — `41004999` is always less than `41005001`. This eliminates the need for a verse-count lookup table.
*Rests on: O39*

**L23: Extending a parser is lower-risk than adding a second code path.**
The alternative was a client-side Bible reference parser in the Aquifer Window that pre-converts "Mark 4" before calling the MCP search tool. This would have duplicated reference resolution logic across two codebases. Fixing `parseReference` at the source means every consumer (MCP clients, Aquifer Window, future integrations) benefits from one change.
*Rests on: O40*

### Decisions

**D32: Extend `parseReference` with six new regex blocks for book-only, chapter-only, and chapter-range references in both USFM and human-readable name formats.**
*Because* any reasonable Bible reference should route to passage search, not title search. The existing regex patterns only handled `chapter:verse` — three common granularities were missing.
*Formats added:* `Mark` / `MRK` (book only → `41001001-41999999`), `Mark 4` / `MRK 4` (chapter only → `41004001-41004999`), `Mark 4-6` / `MRK 4-6` (chapter range → `41004001-41006999`).
*Alternatives considered:* (A) Client-side parser in Aquifer Window — rejected because it duplicates logic. (B) Hybrid search: try `parseReference`, on null try book name lookup before title search — rejected as unnecessary complexity when extending the parser is simpler.
*Rests on: O38, O39, O40*
*Reversible: Yes — regex blocks can be removed independently*

**D33: Update `rangeToReadable` to detect sentinel ranges and display them as book-only, chapter-only, or chapter-range format.**
*Because* sentinel ranges like `41004001-41004999` would otherwise render as "MRK 4:1-999" in search results. Detection logic: when `s.verse === 1 && e.verse === 999`, check chapter patterns to render "MRK", "MRK 4", or "MRK 4-6".
*Rests on: D32*
*Reversible: Yes*

### Constraint Updates

**C3 strengthened: BBCCCVVV is the location standard at all granularities.**
Previously, BBCCCVVV was used only for verse-level and verse-range references. Now it also represents chapter-only (`BBCCC001-BBCCC999`), chapter-range (`BBccc001-BBCCC999`), and book-only (`BB001001-BB999999`) queries via sentinel values.
*Status: Active, verified*

### Evidence

- 104 tests passed (53 references, 34 tools, 17 telemetry), 0 failures
- 20+ new test cases covering all 6 new reference formats, sentinel display in `rangeToReadable`, and sentinel boundary correctness in `rangesOverlap`
- Pre-implementation boundary proof: 6 string comparison assertions confirming sentinel safety at chapter and book boundaries
- Files changed: `src/references.ts`, `src/references.test.ts` only

### Known Tradeoffs

- Book names that are common English words ("Job", "Numbers", "Ruth", "Mark") will resolve to book references instead of keyword searches. Acceptable in the Bible-focused context; revisit if false-positive reports emerge.
- Sentinel verse value 999 exceeds real verse counts (max is 176 in Psalm 119). This is a search range, not a data integrity assertion — no correctness impact.

---

## v1.0.0 through v1.2.0 Appendix

> Covers the planning session through v1.0.0 ship, v1.1.0 R2 migration, and v1.2.0 patch + per-resource index rearchitecture.

### Observations

**O41: Every tool call fires 49 GitHub API requests before checking cache.**
`getOrBuildIndex()` calls `fetchOrgRepos()` (1 request) then `fetchAllRepoShas()` (48 parallel requests) to compute the composite SHA before checking KV. Even with ETags and 304s, this is 49 round-trips minimum on every single tool invocation.
*Source: Direct code inspection of `registry.ts:13-17`, `github.ts:27-66, 73-119`*

**O42: Entity search (`bootstrapEntityMatches`) scans ALL resources × ALL files × ALL articles sequentially.**
When not cached, the function at `tools.ts:634-656` iterates every resource, every content file within each resource, and every article within each file in nested `for` loops. No `Promise.allSettled`. For 48 repos this is catastrophically slow.
*Source: Direct code inspection of `tools.ts:634-656`*

**O43: No tool returns Bible verse text.**
v0.9.0 has 8 tools. None provide deterministic Book/Chapter/Verse → text. `get` requires knowing the `content_id` in advance. `search` returns references, not content.
*Source: Tool inventory in `index.ts`, verified against live `tools/list` response*

**O44: Reference parser lacks common abbreviations.**
`BOOK_NAME_TO_USFM` in `references.ts:22-41` has only full names ("romans", "genesis") and no aliases ("rom", "gen", "jn", "ps").
*Source: Direct inspection of `references.ts`*

**O45: Bible resources show "Articles: 0" in `list` output.**
`registry.ts:94` counts articles as `Object.keys(metadata.article_metadata ?? {}).length`. For Bible resources where `article_metadata` is absent, this returns 0.
*Source: Code inspection and `list({ type: "Bible" })` against v0.9.0*

**O46: ChatGPT recommended 10 improvements; 4 already exist in the architecture.**
ChatGPT recommending existing features indicates the tool descriptions aren't self-documenting.
*Source: ChatGPT MCP feedback triage against actual codebase*

**O47: translation-helps-mcp achieves sub-250ms warm calls using R2 + Cache API.**
R2 for ZIP files and extracted content. Cache API as hot-read layer (~1ms). Version-keyed cache invalidation on deploy.
*Source: Direct inspection of `src/functions/r2-storage.ts`, `src/services/ZipResourceFetcher2.ts`*

**O48: oddkit uses KV for small values + R2 for files. Content-addressed by SHA + INDEX_VERSION.**
`workers/src/zip-baseline-fetcher.ts` (801 lines). KV for SHA pointers and serialized index. R2 for ZIP files and extracted individual files.
*Source: Direct inspection of oddkit `workers/src/zip-baseline-fetcher.ts`*

**O49: Both reference implementations use source-URI-based R2 key naming.**
oddkit: `file/{repo_key}/{commit_sha}/{path}`. translation-helps-mcp: `by-url/{host}/{path_to_archive.zip}/files/{inner_path}`. The key IS the provenance.
*Source: Direct inspection of both codebases*

**O50: KV's 25MB limit silently fails index writes, defeating all caching strategies built on top.**
The navigability index for 48 repos exceeds KV's 25MB value limit. The `catch {}` swallows the write failure. Every subsequent request falls through to a full rebuild. This is why v1.0.0 warm calls are 7-13 seconds.
*Source: Verified by curl timing tests against v1.0.0 deploy preview*

**O51: Cursor bugbot found the pointer-advance-on-failed-write bug.**
In `refreshShasIfStale`, when KV `put` fails (oversized index), `updatePointer` runs unconditionally, replacing a working pointer with a broken one.
*Source: Cursor bugbot PR review on PR #9, commit 3d09a1c*

**O52: Cursor bugbot found entity handler language filter and type sorting bugs.**
`handleEntity` accepted a `language` parameter but never filtered results by it. `typeOrder` used "StudyNotes" (no space) but actual values have a space ("Study Notes").
*Source: Cursor bugbot PR review on PR #9*

**O53: CI workflow has a branch protection check name mismatch.**
`ci.yml` triggers on `push` (to main) and `pull_request` (all branches). GitHub reports different check names for each. Branch protection waits for the `push` variant that never fires on PR branches.
*Source: GitHub PR #9 status checks*

**O54: Scripture tool adds a `### Title` header above every verse.**
Aquifer Bibles store each verse as a separate article with its own `title` field. `handleScripture` at line 936 pushes `### ${m.title}` for every matching article. For "Rom 3:23-25" this produces 3 headers above 3 verses. Unreadable as scripture.
*Source: Direct inspection of `tools.ts:936`, verified against live response*

**O55: Aquifer Bible content already has inline verse numbers.**
Raw HTML: `<p><sup>23</sup>&nbsp;for all have sinned...`. After `stripHtml`, this becomes `23 for all have sinned...`.
*Source: Fetched `BereanStandardBible/eng/json/45.content.json` from GitHub*

**O56: translation-helps-mcp joins verses into flowing text with `verses.join(" ")`.**
`extractVerseRangeWithNumbers` in `usfm-extractor.ts:166-174` collects verse texts as `${v} ${verseText}` and joins with spaces. No headers.
*Source: Direct inspection of `src/functions/usfm-extractor.ts`*

**O57: README says "eight tools" and "version 0.9.0" — ChatGPT reads this and misses `scripture` and `entity`.**
The `readme` tool serves the README which has stale version references and tool counts. ChatGPT literally doesn't know the new tools exist.
*Source: `readme({ refresh: true })` output inspection*

**O58: `list({ type: "Bible" })` returns 8 results including Bible Dictionary, Bible Stories, Bible Translation Manual.**
The type filter is substring-based (`resource_type.toLowerCase().includes(t)`), so "Bible" matches anything with "Bible" in the name.
*Source: `list({ type: "Bible" })` against live production*

**O59: `search("David")` returns 49 title matches; `entity("person:David")` returns 2,448 articles.**
Very different result sets for the same concept. Users don't know to try `entity` after getting title-only results from `search`.
*Source: Side-by-side testing against live production*

**O60: Aquifer Window has a gamified telemetry leaderboard at `/pulse`.**
The Window is the #1 consumer at 590 calls. Real usage data flowing through the telemetry system.
*Source: `telemetry_public` response*

**O61: The navigability index is 10-50MB serialized because it aggregates ALL 48 repos into one monolithic blob.**
R2 stores and serves it successfully. Cache API delivers it fast. But `JSON.parse` in the Workers runtime takes 1-2 seconds. Translation-helps-mcp never builds a global index — each resource is independently discovered, fetched, and cached.
*Source: 20-call timing test against v1.1.0 deploy preview (consistent 1.3-3.2s)*

**O62: Parallel fan-out across 48 small R2/Cache API reads is ~40x faster than one 10-50MB JSON.parse.**
Workers can do parallel subrequests. 48 reads complete in time of the slowest (~10-50ms via Cache API), not the sum. Parsing 48 × 50KB (~50ms parallel) vs 1 × 10MB (~2s serial).
*Source: Cloudflare Workers subrequest behavior, translation-helps-mcp proven architecture*

### Learnings

**L24: Content-addressed caching is correct but computing the cache key must not be on the hot path.**
v0.4.0's SHA-keyed caching is the right correctness model. But computing the composite SHA requires fetching 49 API responses — which defeats caching if done on every request.
*Rests on: O41, O50*

**L25: KV is for pointers and counters. R2 is for content. Using KV for content is the wrong tool.**
KV has a 25MB value limit. R2 has no size limit. Cache API provides ~1ms edge reads on top of R2.
*Rests on: O47, O48, O50*

**L26: The storage key IS the provenance.**
If you can't read a storage key and know where the content came from, what version it is, and what it contains, you've lost debuggability. Both reference implementations encode source URI, commit SHA, and file path in the key.
*Rests on: O49*

**L27: ChatGPT recommending features that already exist is a discoverability problem, not a capability gap.**
Progressive disclosure, cross-resource linking, result grouping, and pagination all exist. The tool descriptions and README need to make this obvious.
*Rests on: O46*

**L28: Bible abbreviation support is table stakes for any scripture tool.**
Agents and users both use abbreviations constantly. "Rom", "Jn", "Gen", "Ps" must work.
*Rests on: O44*

**L29: No version numbers in running prose. Version history belongs in CHANGELOG.md.**
Every inline version reference creates a future drift obligation that will be forgotten. The README should describe current capabilities. The CHANGELOG records history.
*Rests on: O57*

**L30: Scripture output should read like scripture, not like an index.**
Per-verse headers are the wrong formatting for Bible text. The data already has inline verse numbers. Joining verses with spaces produces readable flowing text.
*Rests on: O54, O55, O56*

**L31: Automated bug bots find real bugs that humans miss.**
Cursor bugbot caught the pointer-advance-on-failed-write bug (O51) and the entity handler language filter/sort bugs (O52). Both would have affected production behavior.
*Rests on: O51, O52*

**L32: Ship what works, fix what's slow.**
v1.0.0's functional features are correct and valuable even at 7-13s response times. Blocking the feature ship on a storage migration would have delayed scripture/entity/abbreviation value.
*Rests on: Decision to ship v1.0.0 then follow with v1.1.0 R2 migration*

**L33: The monolithic index is the fundamental architectural mistake — not KV vs R2.**
v1.0.0's problem was storage (KV 25MB limit). v1.1.0 fixed storage with R2 (6x speedup). v1.1.0's remaining problem is that a single 10-50MB JSON blob gets parsed on every request. The fix is eliminating the monolith. Per-resource indexes (each 10-500KB) loaded on demand at query time is how translation-helps-mcp achieves sub-250ms.
*Rests on: O61, v1.1.0 timing results*

**L34: Discrete per-resource indexes enable BM25 full-text search as a natural extension.**
With a monolith you'd need to BM25-index 45,000+ articles in one blob. With per-resource indexes, each resource gets its own BM25 index. Keyword search fans out, collects scored results, merges and ranks.
*Rests on: O62*

### Decisions

**D34: Promote to v1.0.0 with 7 functional changes.**
*Because* the scripture tool + entity tool + abbreviation expansion make the server production-viable for its primary use case.
*Changes:* Two-tier index loading, scripture tool, entity tool, abbreviation expansion (~80 entries), parallel entity bootstrap, Articles:0 fix + capabilities hint, ctx threading.
*Rests on: O41-O45*
*Reversible: Yes*

**D35: Ship v1.0.0 at 7-13s warm calls, follow immediately with v1.1.0 R2 migration.**
*Because* the functional features are correct and valuable even at current performance.
*Rests on: O50, O47, O48*
*Reversible: Yes*

**D36: Migrate to three-tier storage (Memory → Cache API → R2) in v1.1.0.**
*Because* KV's 25MB limit silently fails index writes.
*Implementation:* New `AquiferStorage` class, R2 bucket `aquifer-content`, KV retained for pointers/ETags/telemetry only.
*Rests on: O47, O48, O49, O50*
*Reversible: Yes*

**D37: R2 key naming follows source-URI-as-provenance pattern from both reference implementations.**
*Because* the key must encode full provenance for debuggability and prefix-based cleanup.
*Rests on: O49*
*Reversible: Yes*

**D38: Deploys via Cloudflare Workers Builds (dashboard Git hooks) only.**
*Because* this is the existing deployment model.
*Rests on: Klappy confirmation, existing `DEPLOY-SETUP.md`*

**D39: No version numbers in running prose — README, CLAUDE.md, tool descriptions.**
*Because* every inline version reference creates drift that confuses MCP clients.
*Rests on: O57*
*Reversible: Yes*

**D40: Fix scripture output to flow as joined verse text, not per-verse headers.**
*Because* line 936 adds `### {title}` for every verse-article, making multi-verse responses unreadable. The data already has inline verse numbers.
*Rests on: O54, O55, O56*
*Reversible: Yes*

**D41: R2 bucket `aquifer-content` pre-created on Cloudflare account.**
*Because* the bucket must exist before deploy. Created 2026-03-31.
*Rests on: D36*
*Irreversible: Bucket exists, can be deleted if not needed*

**D42: Ship v1.1.0 as a 6x improvement. Rearchitect to per-resource indexes in v1.2.0.**
*Because* v1.1.0 fixes the storage primitive (6x speedup). Per-resource indexes eliminate the monolith that causes ~2s JSON.parse on every request.
*Rests on: O61, L33*
*Reversible: Yes*

**D43: Per-resource indexes with parallel fan-out replace the monolithic navigability index in v1.2.0.**
*Because* parallel reads of 48 small indexes (~50ms via Cache API) is ~40x faster than one 10-50MB JSON.parse (~2s). Global registry (~5KB) in KV/R2. Per-resource passage and title indexes in R2. Fan-out via `Promise.allSettled`. BM25 becomes a natural extension.
*Rests on: O61, O62, L33, L34*
*Reversible: Yes — monolith can coexist during migration*

### Constraints

**C16: No version numbers in running prose. Version history in CHANGELOG.md only.**
Exception: `package.json` and `/health` endpoint contain the structural version. Tool descriptions describe capabilities, not version history.
*Status: Active*

**C17: R2 for file-shaped content. KV for pointer-shaped values only.**
KV values must be under 1KB (SHA pointers, ETags, timestamps, telemetry counters). All file-shaped storage goes to R2.
*Status: Active*

**C18: Storage keys must encode full provenance.**
Every R2 key must contain enough information to identify the source, version, and content. Pattern: `{type}/{resource_code}/{sha}/{language}/{file}`.
*Status: Active*

**C19: Cache API keys versioned by APP_VERSION.**
New deploys get fresh caches automatically. No manual flush for correctness.
*Status: Active*

**C20: Scripture output must read as flowing text, not per-verse headers.**
Verse numbers inline, verses joined with spaces. Resource/translation headers only at the `##` level.
*Status: Active*

**C21: Search fan-out must use Promise.allSettled across per-resource indexes — never serial.**
Parallel is the entire point. Serial fan-out across 48 resources would be worse than the monolith.
*Status: Active*

### Handoffs

**H1: v1.0.0 → v1.1.0 (R2 migration)**
PRD: `aquifer-mcp-v1.1.0-prd.md`. Completed. R2 bucket `aquifer-content` created. `AquiferStorage` class in `src/storage.ts`. 6x speedup confirmed (11.5s → 2.0s warm calls).

**H2: v1.1.0 → v1.2.0 (Patch fixes + per-resource indexes)**
PRD: `aquifer-mcp-v1.2.0-patch-prd.md`. 8 priorities: (P1) scripture flowing text, (P2) README/CLAUDE.md doc drift, (P3) non-Bible resource_code error, (P4) book-only payload truncation, (P5) exact type filter, (P6) search-to-entity hint, (P7) CI push trigger, (P8) per-resource indexes.

**H3: Aquifer Window update for v1.0.0 tools**
PRD: `aquifer-window-lovable-prd-v1.0.0.md`. The Window needs to know about `scripture` and `entity` tools.

**H4: Telemetry transparency headers**
The Claude connector shows as "Claude-User" / "Silent Reporter" at 0% transparency. The `x-aquifer-client` and related headers should be sent by MCP clients for leaderboard visibility.

---

## v1.3.0 — X-Ray Performance Tracing (2026-03-31)

*Execution mode. Adds lightweight per-request tracing to diagnose the v1.2.0 hot-path bottleneck.*

### Observations

**O65: We cannot diagnose the v1.2.0 performance bottleneck without internal timing instrumentation.**
Curl timing shows 1.3-2s total but not whether the time is in KV, R2, Cache API, JSON.parse, fan-out, or background refresh. The per-resource index architecture is correct but something in the hot path is still expensive.
*Source: v1.2.0 deploy preview testing — consistent 1.3-2s despite lightweight index + per-resource fan-out*

**O66: translation-helps-mcp solved this with `EdgeXRayTracer` — a lightweight edge-compatible tracer that records every API call, storage read, and cache hit/miss with timing.**
The tracer wraps fetch and storage operations, accumulates spans during the request, and serializes to a response header. Zero external dependencies, zero storage overhead.
*Source: Direct inspection of `reference/translation-helps-mcp/src/functions/edge-xray.ts`*

### Learnings

**L36: Measure before optimizing — x-ray tracing is a prerequisite for further performance work.**
translation-helps-mcp has this (EdgeXRayTracer). oddkit doesn't need it (single repo, fast by default). Aquifer MCP has 48 repos, three storage tiers, and fan-out queries — it needs observability into which tier and which operation is consuming time.
*Rests on: O65, O66, translation-helps-mcp reference implementation*

### Decisions

**D43: Add x-ray request tracing via response headers before any further performance optimization.**
*Because* we've made two architectural changes (R2 migration, per-resource indexes) without being able to measure their actual impact on the hot path. Further optimization without instrumentation is guessing.
*Implementation:* `RequestTracer` class in `src/tracing.ts`. Optional `tracer` parameter threaded through `AquiferStorage.getJSON`, `getOrBuildIndex`, `fanOutPassageSearch`, `fanOutTitleSearch`, and all tool handlers. `X-Aquifer-Trace` response header on every `/mcp` POST.
*Rests on: O65, O66, L36*
*Reversible: Yes — tracer is optional throughout, header can be removed*

### Files Changed

- `src/tracing.ts` — **New.** `RequestTracer` class with `trace()`, `addSpan()`, `toHeader()`, `toJSON()`, and `shortKey()` utility.
- `src/storage.ts` — Added optional `tracer` param to `getJSON()`. Each tier (memory/cache/r2/miss) records a span with source and timing.
- `src/registry.ts` — Added optional `tracer` param to `getOrBuildIndex()`, `fanOutPassageSearch()`, `fanOutTitleSearch()`. KV pointer, index load, fan-out queries all traced with hit/miss counts.
- `src/tools.ts` — Added optional `tracer` param to all tool handlers. Threaded through to registry and storage calls.
- `src/index.ts` — Creates `RequestTracer` per request, passes to `createServer()`, adds `X-Aquifer-Trace` header to response.

### Evidence

- 142 tests passed (80 references, 45 tools, 17 telemetry), 0 failures
- TypeScript compilation clean (no new errors from tracing changes)
- Wrangler dry-run build succeeds

### Handoff

**H5: v1.3.0 → performance diagnosis**
Deploy and run curl timing tests against production. Read `X-Aquifer-Trace` header to identify which storage tier and operation consumes the most time. Then optimize the specific bottleneck — not guessing.

---

## v1.3.0 — Per-Resource Article Lookup Indexes (2026-03-31)

*Execution mode. Eliminates full-file scanning from content access tools.*

### Observations

**O66: Every content access downloads entire book files (350KB-1.7MB) and scans every article.**
`handleScripture` fetches `43.content.json` (878 articles, 352KB for John) for each of 5 Bible resources and calls `rangesOverlap` on every article. `findArticle` lists ALL content files and scans them sequentially. `bootstrapEntityMatches` scans ALL resources × ALL files × ALL articles. This is the systemic cause of 1.5-3s response times.
*Source: Direct code inspection of `tools.ts:findArticle`, `handleScripture`, and `bootstrapEntityMatches`, verified by head-to-head comparison with translation-helps-mcp (119ms vs 1.8-3.2s)*

**O67: Bible content_id = "1" + BBCCCVVV index_reference. Verified 878/878 for John.**
Content_id `143003016` for John 3:16. `index_reference` = `43003016`. Pattern holds for every article in the book.
*Source: Verified by checking all 878 articles in `BereanStandardBible/eng/json/43.content.json`*

**O68: For canonical resources, 100% of articles have file-derivable index_references.**
`index_reference[:2]` = book number → `{book_number}.content.json`. Verified 16,923/16,923 articles in AquiferOpenStudyNotes.
*Source: Programmatic verification against AquiferOpenStudyNotes metadata.json*

**O69: metadata.json `article_metadata` contains content_id + index_reference for every article in every resource.**
This is everything needed to build a content_id → file lookup at index build time without fetching content files.
*Source: Direct inspection of metadata.json for multiple resource types*

### Learnings

**L37: The content access pattern is the systemic problem — not the index, not the storage, not the caching.**
v1.1.0 fixed storage (KV → R2). v1.2.0 fixed the index (monolith → per-resource). Both were real improvements. But the 15-25x gap with translation-helps-mcp exists because every tool downloads entire book files and scans them.
*Rests on: O66, x-ray tracing*

**L38: Build lookup indexes from metadata at index build time — scanning is a cold-path cost, not a hot-path cost.**
Metadata.json already has content_id + index_reference for every article. For canonical resources, file derivation is deterministic. For non-canonical resources, a one-time scan during index build maps content_ids to files.
*Rests on: O67, O68, O69*

### Decisions

**D44: Eliminate full-file scanning from `get` and `browse` via per-resource article lookup indexes.**
*Because* `findArticle` scanned all content files sequentially, and `buildCatalog` fetched all content files to build a paginated catalog. A per-resource article lookup index (`content_id → { file, ref, title }`) stored in R2 fixes both at once. Built from metadata during index build — zero hot-path scanning for canonical resources.
*Implementation:*
- New R2 key: `index/{resource_code}/{sha}/articles.json`
- Built during `buildIndex` from `article_metadata` (no content file fetches needed for canonical resources)
- `findArticle`: loads article lookup (~100KB, cached), reads the exact content file
- `handleBrowse`: uses article lookup for non-media resources (title, ref, content_id from metadata), falls back to content file scanning for media resources that need image URLs
- Fallback chain preserved: KV hint → index_reference derivation → metadata file list
*Rests on: O66-O69, L37, L38*
*Reversible: Yes — article lookup indexes are additive, existing fallback patterns preserved*

### Constraint Updates

**C22 (new): No tool handler may scan an entire content file at query time when a lookup index is available.**
Load the article lookup index (~100KB from cache) to find the file. Never load a 350KB-1.7MB content file and `.find()` through it.
*Exception: media resources (Images, Videos) still need content file scanning for image_url extraction during catalog build, cached after first build.*
*Status: Active*

### Files Changed

- `src/storage.ts` — Added `articleIndexKey(resourceCode, sha)` key builder.
- `src/registry.ts` — Builds article lookup index during `buildIndex`, exports `loadArticleLookup` and `ArticleLookupEntry` type.
- `src/tools.ts` — `findArticle` uses article lookup index as fast path with fallback. `handleBrowse` uses `buildCatalogFast` which builds catalog from article index for non-media resources.

### Evidence

- 142 tests passed (80 references, 45 tools, 17 telemetry), 0 failures
- TypeScript compilation clean (no new errors)
- Wrangler dry-run build succeeds

### Handoff

**H6: v1.3.0 deploy → verify with x-ray tracing**
Deploy and verify that `get` tool calls show article lookup index load (~5ms from cache) + single content file fetch, not sequential file scanning. `browse` for non-media resources should show zero content file fetches. Scripture tool unchanged (already fetches correct book file by construction).

---

## v1.4.0 — Version Indexes Per Release + Complete X-Ray Coverage

### Observations

**O70: SSE transport overhead from `createMcpHandler` is ~35ms, not ~1,000ms.**
Testing `tools/list` (no index, no tool execution) across 20 calls: aquifer-mcp p50=173ms, translation-helps-mcp p50=138ms. oddkit uses the same `createMcpHandler` successfully. Initial hypothesis that SSE caused ~1,000ms overhead was wrong.
*Source: 20-call p50 comparison from same test machine, both on Cloudflare Workers*

**O71: `APP_VERSION` in `storage.ts` is hardcoded as `"1.3.0"` while User-Agent strings are still at `1.2.0` — already stale.**
Cache API keys use this version prefix, so index schema changes between releases don't invalidate stale cached indexes.
*Source: Direct inspection of `src/storage.ts` line 9, `src/github.ts` lines 38/84/134, `src/tools.ts` line 98*

**O72: translation-helps-mcp auto-generates `version.ts` from a sync script, uses it everywhere.**
Cache API keys, health endpoint, MCP server info all import from this single source. New deploy = version bump = cache miss = fresh indexes.
*Source: Direct inspection of translation-helps-mcp `src/version.ts` and `src/functions/r2-storage.ts`*

**O73: X-ray trace covers only `getOrBuildIndex` — ~1,200ms of tool execution is completely untraced.**
Search shows 112-168ms trace but 1,386ms p50. The gap is fan-out queries, content file fetches, and tool handler logic. Functions missing tracer: `fetchContentFile`, `getResourceMetadata`, `resolveIndexReference`, `listContentFiles`, `buildCatalog`, `bootstrapEntityMatches`. The `fetchJson` function in `github.ts` called `storage.getJSON` without passing tracer.
*Source: v1.3.0 x-ray traces vs 20-call p50 curl timings, code inspection of tracer threading*

### Learnings

**L39: Measure the transport before blaming it — SSE overhead was 35ms, not 1,000ms.**
The initial SSE hypothesis was plausible but wrong. The lesson: measure each layer independently before proposing architectural changes.
*Rests on: O70*

**L40: Version must be auto-generated from a single source — manual bumping creates drift.**
Every manually-bumped version string is a future drift obligation that will be forgotten. `package.json` is the single source. Everything else derives from it at build time.
*Rests on: O71, O72*

### Decisions

**D45: Keep `createMcpHandler` — do not replace SSE transport.**
*Because* the SSE overhead is ~35ms, not ~1,000ms. oddkit uses the same handler. Ditching it would break compatibility for zero gain.
*Rests on: O70, L39*

**D46: Auto-generate `src/version.ts` from `package.json` at build time.**
*Because* hardcoded APP_VERSION is already stale and will drift again on every release. Translation-helps-mcp's pattern is proven.
*Rests on: O71, O72, L40*
*Reversible: Yes*

**D47: Thread tracer through every I/O function in the tool handler chain.**
*Because* ~1,200ms of tool execution is completely untraced. Every `await` that does I/O must be traced so the X-Aquifer-Trace header shows the complete call stack, not just the index load.
*Rests on: O73*
*Reversible: Yes — tracer is optional param everywhere*

### Constraints

**C23 (new): No hardcoded version strings anywhere. All version references import from the generated `src/version.ts`.**
`package.json` is the single source. `prebuild` script generates `version.ts`. Health endpoint, MCP server info, Cache API keys, User-Agent headers all import from it.
*Status: Active after v1.4.0*

### Files Changed

- `src/version.ts` — **New.** Auto-generated single source of truth for VERSION constant.
- `src/index.ts` — Imports `VERSION` from `version.ts`. Hardcoded version strings replaced in McpServer constructor and health endpoint.
- `src/storage.ts` — Imports `VERSION` from `version.ts`. Removed hardcoded `APP_VERSION = "1.3.0"`.
- `src/github.ts` — Imports `VERSION` and `RequestTracer`. User-Agent now `aquifer-mcp/${VERSION}`. `fetchJson` accepts optional `tracer` param, passes to `storage.getJSON`.
- `src/tools.ts` — Imports `VERSION`. User-Agent now `aquifer-mcp/${VERSION}`. Tracer threaded through: `fetchContentFile`, `getResourceMetadata`, `resolveIndexReference`, `listContentFiles`, `findArticle`, `buildCatalog`, `buildCatalogFast`, `bootstrapEntityMatches`, and all call sites in `handleScripture`, `handleBrowse`, `handleEntity`. Aggregate spans added: `scripture-fetch`, `find-article`, `entity-bootstrap`.
- `package.json` — Bumped to 1.4.0. Added `prebuild` script. Build/deploy scripts chain `prebuild`.
- `CHANGELOG.md` — v1.4.0 entry.

### Evidence

- 142 tests passed (80 references, 45 tools, 17 telemetry), 0 failures
- Zero source file type errors (12 pre-existing test file type errors unchanged)
- Wrangler dry-run build succeeds (2691.90 KiB / gzip: 449.91 KiB)

### Handoff

**H7: v1.4.0 deploy → trace validation**
Deploy and verify that X-Aquifer-Trace now shows the complete call stack for `search`, `scripture`, `get`, and `entity` tool calls. The trace should account for >90% of curl total time. Look for: `fanout-passages`, `scripture-fetch`, `find-article`, `entity-bootstrap` aggregate spans alongside per-resource `storage:*` spans. Compare trace total with curl total — the untraced gap should drop from ~1,200ms to <100ms.
