# Changelog

All notable changes to aquifer-mcp will be documented in this file.

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
- Entity index builds incrementally from fetched content (sparse until articles are retrieved via `get`)
- Alphabetical resource `get` may try up to 10 content files sequentially
- Not yet tested against full 48-repo set (including Bible repos and potentially private Tyndale repos)
- No production deployment yet (runs on `wrangler dev` only)
