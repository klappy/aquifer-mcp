# Bible Aquifer — Privacy Policy

**Effective date:** March 30, 2026
**Last updated:** March 30, 2026
**Operator:** Christopher Klapp (klappy.dev)
**Service:** Bible Aquifer MCP Server (aquifer.klappy.dev)

---

## Overview

Bible Aquifer is a read-only service that provides AI assistants with access to openly-licensed Bible scholarship resources from the BibleAquifer collection. This policy describes what data the service collects, what it does not collect, and how collected data is used.

The guiding principle is **anonymity by default**: the service tracks system behavior with high fidelity while protecting user anonymity.

---

## What We Do NOT Collect

Bible Aquifer does **not** collect, store, or process:

- **User identity** — no names, email addresses, account IDs, or login credentials.
- **Raw prompts or queries** — the text of what you ask is never stored. Search queries are classified by pattern (passage, entity, or keyword) without recording the actual query text.
- **Article content or model responses** — the content returned to you is not logged.
- **IP addresses** — no network-level identifiers are recorded.
- **Browser or device fingerprinting** — no cookies, user agents for tracking, or device identifiers.
- **Behavioral profiles** — no tracking across sessions or over time.

---

## What We Collect

The server automatically records **anonymous, aggregate operational data** for each tool call:

- **Request counts** — total MCP requests and tool calls.
- **Tool usage** — which tools are called (list, search, get, related, browse) and how often.
- **Resource access counts** — which Bible resources are accessed, by repository name (e.g., "BiblicaStudyNotes"). These are structural identifiers, not user content.
- **Language counts** — which language codes are requested (e.g., "eng", "fra").
- **Article access counts** — which articles are accessed, by compound key (resource + language + content ID). These are catalog identifiers, not user-generated data.
- **Search type breakdown** — how many searches are passage-based, entity-based, or keyword-based, classified by pattern without storing the query itself.
- **Consumer labels** — if an MCP client identifies itself (via headers or initialization), that self-declared label is recorded for aggregate leaderboard display. These labels are voluntary and not verified unless explicitly allowlisted.
- **Last article accessed** — a single record of the most recent article retrieval (compound key, tool name, timestamp) as a system heartbeat.

All of the above is aggregate and anonymous. No data point can be traced to an individual user.

---

## How We Use Collected Data

Collected data is used exclusively for:

- **Operational visibility** — understanding which resources, languages, and articles are used to inform collection priorities.
- **Public transparency** — aggregate usage statistics are published via the `telemetry_public` tool and are visible to anyone. This includes resource leaderboards, language distribution, and search type breakdowns.
- **System health** — monitoring request volume, cache behavior, and error rates.

Data is **not** used for advertising, profiling, selling to third parties, or any purpose beyond operating and improving the service.

---

## Data Storage and Retention

Telemetry data is stored in Cloudflare Workers KV as aggregate counters. Individual request details are not retained — only running totals and the single most-recent-article record. KV entries use time-to-live (TTL) expiration and are periodically cleared as part of normal cache management.

No data is exported to external analytics services, advertising networks, or third-party data brokers.

---

## Authentication

Bible Aquifer does not require authentication. There are no user accounts, no login, and no stored credentials. The service is entirely anonymous and read-only.

---

## Third-Party Data

Bible Aquifer fetches openly-licensed content from BibleAquifer GitHub repositories at runtime. No user data is sent to GitHub or any other third party as part of this process. GitHub receives standard HTTP requests for public repository content; these requests do not contain user-identifying information.

---

## Children's Privacy

Bible Aquifer does not knowingly collect any personal information from anyone, including children under 13. Since the service collects no personal information at all, no special provisions for children's data are necessary.

---

## Changes to This Policy

If this policy changes, the updated version will be published at the same URL with an updated "Last updated" date. Material changes will be noted in the project changelog.

---

## Contact

For questions about this privacy policy or the Bible Aquifer service:

- **GitHub:** [github.com/klappy/aquifer-mcp](https://github.com/klappy/aquifer-mcp)
- **Website:** [klappy.dev](https://klappy.dev)

---

## Full Telemetry Policy

For the complete technical telemetry specification — including allowed optional client sharing, required exclusions, recommended event families, and leaderboard integrity rules — query the `telemetry_policy` tool on the Bible Aquifer MCP server, or see the telemetry governance documentation in the project repository.
