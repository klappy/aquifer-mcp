# Language catalog module delivery

Base0bf087a73cb6b8fcadba27ce197f38ce54fe8478; ticket17fdf3d5. Pure module and injected-reader interface only. No tools.ts, live fetch, cache wiring or deployment changes. Existing media module remains a separately reviewed delivery.

17 targeted fixtures pass. Scoped strict TypeScript compilation passes. Full suite at the 15-fixture checkpoint:198 pass/1 existing live-org-coverage failure. Exact baseline independently had183 pass/1 same failure. Full typecheck output is byte-identical to baseline legacy errors; no new module diagnostic remains. The final two fixtures additionally verify exact-ID precedence and failed-only scan restart behavior. Worker dry-run build succeeds; no deployment occurred.

Original bytes are hashed before parsing; file and HTML hashes are separate. Source language conflicts fail instead of synthesizing availability. Duplicate conflicts remove the candidate entry. Pinned URL and cache-key helpers use exact revisions and v2 namespaces. These helpers cannot prove a caller actually used them; integration must verify exact live request URLs and response hashes and must not reuse prior main-fetched cache values.

Scan continuation and result paging are separate. Prior-state/cursor binding is a consistency check, not authentication: integration must keep prior envelopes server-side rather than trusting client-provided state. Failed sources never become verified empty and are not silently retried. Explicit aliases are metadata-bound and target actual entries; exact IDs take precedence. Caller-provided collection rights and media extraction are not conflated with catalog completeness.

Initial fixture accidentally supplied the default Spanish language instead of omitting it; corrected fixture now explicitly removes the field and observes source-path provenance. Initial Workers type errors for TextDecoder options and digest input were corrected without broad baseline changes. No provider calls, recording generation or blocked official-site access occurred.

Independent review reproduced an earlier-page alias shadowing a later exact ID when metadata was omitted on continuation. The cumulative catalog now prunes aliases against all current exact IDs after every scan. The cross-page regression verifies the first snapshot remains unchanged while final exact-ID precedence is restored. All18 targeted fixtures and strict module compilation pass. No broad implementation changes.
