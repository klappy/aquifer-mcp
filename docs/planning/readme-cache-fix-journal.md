# Handoff: Journal Entry for readme cache fix

Append the following to `odd/ledger/journal.md`, after the existing H7 entry. Do not modify any other content in the journal or any other files.

---

## PR #XX — Fix Anti-Cache Lying violation in readme tool

### Observations

**O91: The `readme` tool served stale content ("version 0.9.0") for months after the project reached 1.5.0.**
The cache key `readme:v1:main` is static — not content-addressed. TTL acted as freshness, not garbage collection. Discovered when the Aquifer Window displayed an ancient README.

**O92: The README contains a hardcoded tool count ("ten tools") that goes stale when tools are added or removed.**

### Learnings

**L50: Every cache key in the codebase must be SHA-keyed. No exceptions for "simple" tools.**
The readme handler was treated as too simple to need content-addressed caching. It was the only tool that broke. Simplicity is not an exemption from constraints.

**L51: This is the same bug pattern as the oddkit stale cache incident (February 2026). The lesson was documented but not applied to all cache paths.**

### Decisions

**D54: Content-address the readme cache key using `fetchRepoSha("klappy", "aquifer-mcp", env)`.**
*Because* static cache key + TTL = Anti-Cache Lying violation. SHA change = automatic cache miss. No `refresh` parameter needed.
*Reversible: Yes. Rests on: O91, L50.*

**D55: Replace hardcoded tool count ("ten tools") with "these tools" in README.**
*Because* hardcoded counts are projections that go stale. The list itself is the source of truth.
*Reversible: Yes. Rests on: O92.*

### Constraints

**C29: The readme tool's `fetchRepoSha` call adds one KV subrequest per cold call. Acceptable — same pattern used by all other tools, and readme calls are infrequent.**

### Handoffs

**H8: After merge, verify at aquifer.klappy.dev: call `readme` tool, confirm no "0.9.0" and no "ten tools".**
