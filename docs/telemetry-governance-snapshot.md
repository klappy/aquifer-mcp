# Telemetry Governance Snapshot

Date: 2026-03-19  
Scope: `aquifer-mcp` telemetry policy, scoring, and operational boundaries

## Purpose

This document is the single-page operational reference for telemetry governance in `aquifer-mcp`.

It defines:

- what is tracked automatically
- what is optional and self-reported
- how leaderboard scoring works
- what is excluded for safety/privacy
- where data is stored
- known fragility and migration triggers

## Core Policy

- All `tools/call` usage is tracked automatically by the server.
- Additional metadata disclosure is optional (honor-system by default).
- Verified clients receive weighted leaderboard credit.
- Missing optional metadata must never block request handling.

## Mandatory Automatic Tracking

Automatic tracking occurs on `/mcp` POST envelopes for JSON-RPC messages.

For each `tools/call`, the server tracks aggregate counters for:

- request/method counts
- tool-call counts
- tool counts by tool name
- consumer counts by consumer label
- weighted consumer score (verification-aware)
- consumer label source counts
- verification class counts (`verified`, `unverified`)
- self-report completeness points and possible points
- self-report field presence counts
- last recorded timestamp

## Optional Self-Report Fields (Incentivized)

Optional disclosure fields used for transparency scoring:

- `client_name`
- `client_version`
- `agent_name`
- `agent_version`
- `surface`
- `contact_url`
- `policy_url`
- `capabilities`

Recommended headers:

- `x-aquifer-client`
- `x-aquifer-client-version`
- `x-aquifer-agent-name`
- `x-aquifer-agent-version`
- `x-aquifer-surface`
- `x-aquifer-contact-url`
- `x-aquifer-policy-url`
- `x-aquifer-capabilities`

## Verification Model

Verification uses server-side allowlist configuration:

- env var: `TELEMETRY_VERIFIED_CLIENTS`
- format: comma-separated consumer labels
- matching: case-insensitive label match

Example:

`TELEMETRY_VERIFIED_CLIENTS=Cursor,ClaudeDesktop,AquiferWindow`

## Leaderboard Scoring Rules

### Usage Leaderboards

- Raw usage score: `+1` per tracked `tools/call`
- Weighted usage score:
  - verified client: `+10`
  - unverified client: `+1`

### Transparency Leaderboard

For each tracked `tools/call`:

- points gained = number of optional self-report fields present (0-8)
- max points gained = 8

Completeness:

- `completeness_pct = round(total_points / total_possible * 100)`

Badges:

- `Open Ledger` >= 90%
- `Clear Reporter` >= 70%
- `Starter Reporter` >= 40%
- `Hint Reporter` > 0%
- `Silent Reporter` = 0%

## Public Telemetry Surface

`telemetry_public` exposes aggregate transparency data, including:

- totals
- consumer leaderboard
- weighted consumer leaderboard
- transparency leaderboard
- tool leaderboard
- method counts
- label-source counts
- verification-class counts
- self-report field coverage counts
- tracked/excluded fields
- last recorded timestamp

`telemetry_policy` exposes policy and sharing guidance.

## Excluded Data (Safety Boundary)

Must not be collected by default:

- raw prompts
- raw query text
- article content
- model response text
- user identity fields (name/email/account ids)
- IP addresses
- browser/device fingerprinting

## Storage And Infra

Current implementation stores aggregate telemetry counters in Workers KV (`AQUIFER_CACHE`) with telemetry key prefix `telemetry:v1:*`.

Retention behavior follows `GC_TTL` (30 days) as garbage-collection policy.

## Known Fragility And Antifragile Path

Known limitation in current design:

- KV read-modify-write counters can lose increments under concurrent writes.
- KV eventual consistency can temporarily skew live leaderboard ordering.

Migration trigger:

- if observed drift materially impacts trust or ranking integrity, move telemetry writes to a Durable Object aggregator and keep `telemetry_public` contract stable.

## Operating Principle

Mandatory truth at baseline, optional richness by incentive:

- baseline usage is always tracked
- optional details are encouraged, scored, and made visible
- verification increases score weight but never blocks participation

## Related docs

- `docs/branch-and-deployment-strategy.md` — staging vs production Workers and CI
- `README.md` — local dev, deploy commands, MCP URLs
