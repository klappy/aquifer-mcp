# Changelog

All notable changes to aquifer-mcp will be documented in this file.

## [0.6.0] - 2026-03-19

### Added

- New `telemetry_policy` MCP tool for in-band telemetry-sharing guidance, including allowed/excluded fields and surface-specific guidance (`mcp-client`, `aquifer-window`).
- New `telemetry_public` MCP tool exposing public aggregate telemetry and leaderboard data (consumer labels, top tools, method counts, label-source counts).
- New telemetry capture module in `src/telemetry.ts` with `/mcp` envelope instrumentation and KV-backed aggregate counters.
- New telemetry tests in `src/telemetry.test.ts` covering explicit client labels, batch JSON-RPC handling, and snapshot output.
- `docs/branch-and-deployment-strategy.md` — branch model (`main` / `staging` / feature branches), staging vs production Workers, CI and deploy secrets.
- Wrangler `[env.staging]` — Worker `aquifer-mcp-staging` with preview KV (testable Cloudflare deploy without touching production KV).
- GitHub Actions: `ci.yml` (build + test on all PRs/pushes).
- npm scripts `deploy:staging` and `deploy:production`.

### Changed

- Deploy: removed `deploy-staging.yml` and `deploy-production.yml`; deploy is **Cloudflare dashboard Git integration** only (`DEPLOY-SETUP.md`, `docs/branch-and-deployment-strategy.md`). Removed `docs/github-actions-cloudflare-secrets.md`.
- Docs: production Worker `aquifer-mcp` vs Cloudflare Git **preview** hostnames `…-aquifer-mcp.klappy.workers.dev` (prefix from dashboard; not `aquifer-mcp-staging.*`). Wrangler `[env.staging]` remains optional local/maintainer only.
- Updated telemetry disclosures to match observed collection exactly (aggregate counters only, no per-request raw event log claims).
- Added consumer label source tracking (`x-aquifer-client`, `initialize.clientInfo.name`, `user-agent`, `unknown`) to make leaderboard provenance explicit.
- Enforced automatic tracking for all `tools/call` usage and added weighted consumer leaderboard scoring (verified clients `10x` via allowlist).
- Added self-report transparency scoring and badge leaderboard to incentivize richer model/agent metadata disclosure.
- Updated README telemetry section to document public transparency + gamification behavior and exact tracked/excluded fields.
- Bumped runtime, package metadata, and User-Agent strings to `0.6.0`.

## [0.5.2] - 2026-03-19

### Changed

- Updated deployed MCP and health URLs in README to `https://aquifer.klappy.dev`.
- Added live Aquifer Window production URL `https://aquifer-window.klappy.dev` in README.
- Switched default `.cursor/mcp.json` endpoint from localhost to production.
- Bumped runtime, package metadata, and User-Agent strings to `0.5.2`.

## [0.5.1] - 2026-03-19

### Changed

- Moved the first-person build account to the top of the README for narrative-first onboarding.
- Added explicit agent identity line in the first-person section.
- Bumped runtime, package metadata, and User-Agent strings to `0.5.1`.

## [0.5.0] - 2026-03-19

### Added

- New `readme` MCP tool to fetch project README markdown directly through `tools/call`.
- Optional `refresh` argument on `readme` to bypass cached copy and refetch from GitHub.
- README documentation and JSON-RPC example for `readme`.

## [0.4.0] - 2026-03-19

### Changed

- Replaced TTL-first cache correctness with content-addressed SHA-keyed cache keys across index, metadata, content, browse, and entity bootstrap paths.
- Added per-repo SHA resolution with ETag-based conditional requests to reduce GitHub API load while preserving freshness checks.
- Added composite SHA index keying so the navigability index is rebuilt when any tracked repo SHA changes.
- Updated cache TTL semantics to garbage collection only (`GC_TTL`, 30 days), not freshness guarantees.
- Threaded repo SHA lookups through `get`, `related`, and `browse` paths to prevent stale/mixed cache reads.

## [0.3.0] - 2026-03-17

### Added

- **`browse` tool** — paginated article catalog for any resource. Returns titles, content IDs, image URLs, and passage associations. Closes the discovery dead-end for media resources (images, maps, videos) where `search` cannot enumerate articles.
- `BrowseCatalogEntry` interface for lightweight cached catalog entries.
- Image URL extraction from CDN content HTML (`cdn.aquifer.bible` URLs).
- Catalog caching in Workers KV (`browse:v1:{resource_code}:{language}`, 24h TTL).
- Parallel content file fetching via `Promise.allSettled` with graceful partial-failure handling.

### Unchanged

- All existing tool handlers (`handleList`, `handleSearch`, `handleGet`, `handleRelated`) — zero changes.
- Registry, GitHub fetching, reference parsing, types — all untouched.

## [0.2.0] - 2026-03-17

### Changed

- Migrated from hand-rolled JSON-RPC handler to Cloudflare Agents SDK (`createMcpHandler`) for standard Streamable HTTP transport.
- Server now speaks the MCP protocol natively, compatible with Claude.ai custom connectors, Claude Desktop, Cursor, VS Code, Windsurf, and Claude Code.
- Tool definitions moved from static `TOOL_DEFINITIONS` array to `server.tool()` registrations with Zod schemas for runtime validation.
- Added `agents`, `@modelcontextprotocol/sdk`, and `zod` as dependencies.

### Unchanged

- All tool handler logic (`handleList`, `handleSearch`, `handleGet`, `handleRelated`) — zero changes to behavior.
- Health check endpoint at `/health` and `/` (GET).
- Registry, GitHub fetching, reference parsing, types, caching — all untouched.
- `wrangler.toml` — no Durable Objects needed, stateless handler preserved.

## [0.1.1] - 2026-03-16

### Fixed

- `get` now resolves content files from metadata (`scripture_burrito.ingredients`) instead of probing only `000001-000010`, restoring access to alphabetical and monograph resources.
- `get` now supports localized content IDs by resolving non-English article mappings through metadata localizations.
- `search` keyword mode now uses a dedicated title index across all resources rather than passage-indexed records only.
- `search` entity mode now bootstraps cold-start queries by scanning content files for the requested entity and caching matches.
- Passage indexing and overlap checks now validate BBCCCVVV range format before matching, preventing non-range values from polluting passage results.
- Reference deduplication now uses `resource_code + language + content_id` to avoid language collisions.

### Changed

- Index cache schema bumped to include dedicated title search data.
- Project journal updated with execution-phase OLDC entries for the bug-fix cycle.

## [0.1.0] - 2026-03-16

### Added

- Initial Cloudflare Worker MCP server with JSON-RPC over HTTP at `/mcp`
- Four MCP tools: `list`, `search`, `get`, `related`
- **list**: Browse available Aquifer resources filtered by type or language
- **search**: Find articles by passage reference (BBCCCVVV, USFM, or human-readable like "Romans 3:24"), ACAI entity ID, or keyword in titles
- **get**: Fetch full article content with all associations (passage, resource, ACAI) by compound key (resource_code + language + content_id)
- **related**: Traverse article associations to find passage overlaps, resource links, and shared ACAI entities
- Bible reference parser supporting USFM abbreviations (ROM, GEN, MAT), full book names (Romans, Genesis, Matthew), and raw BBCCCVVV format
- Range overlap detection for passage matching
- Registry loader fetching metadata.json from 17 known Aquifer repos in parallel
- Passage index built from article_metadata sections (BBCCCVVV ranges to article references)
- Workers KV caching with 24-hour TTL for index and content
- GitHub raw content fetching for on-demand article retrieval
- Governance SHA fetch for BibleAquifer/docs (not yet wired to cache invalidation)
- Health check endpoint at `/health`
- CORS headers for cross-origin access
- CLAUDE.md with three reference patterns: plumbing (translation-helps-mcp), governance (oddkit), destination (TruthKit)
- Project journal at odd/ledger/journal.md with full OLDC from execution session
- Planning OLDC at docs/aquifer-mcp-oldc.md from planning session
- Handoff documentation at docs/aquifer-mcp-handoff.md
- Rick's schemas (resource v1.1.2, article v1.0.3) and metadata docs in schemas/
- Real sample data: BiblicaStudyNotes metadata (751 articles) and Romans content (27 articles with all 3 association types)
- Cursor MCP config at .cursor/mcp.json for local IDE integration

### Known Limitations

- KV namespace IDs are placeholders (must create via `wrangler kv:namespace create` before deploy)
- Entity index completeness can still vary by cache state, but cold-start entity queries now bootstrap on demand
- Not yet tested against full 48-repo set (including Bible repos and potentially private Tyndale repos)
- No production deployment yet (runs on `wrangler dev` only)
