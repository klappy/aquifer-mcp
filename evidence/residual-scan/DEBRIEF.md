# Residual scan accounting — candidate validation

Base: deployed 57de703f8f7f7fd6363a6453e38aa4cd8bfba32d, also the locally observed origin/main. No remote refresh or deployment performed.

A content file that exceeds the remaining scan allowance stays pending when its observed size does not already prove it exceeds the whole allowance. The invocation stops immediately. A subsequent caller-authorized continuation starts with that exact file. A full-allowance failure or observed file bytes above the whole allowance is terminal oversized-file; no endless automatic retry is introduced. A stream whose full size is unknown may require its next full-allowance attempt to establish oversize; a cached or single-chunk body can prove it immediately.

Accounting is cumulative across cursor snapshots: attemptedReads includes deferrals; scannedFiles counts completed file classifications. attemptedBytes counts bytes delivered to the content reader, including discarded over-limit chunks, or complete cached bytes inspected. networkBytes and cacheBytes separate those sources; acceptedBytes counts accepted bodies before JSON/article validation. These are content-scan counters, not metadata/tree discovery counters or a claim to measure all transport-level prefetch. A delivered chunk can cross the configured limit; it is fully counted, cancellation requested immediately, and no later file read occurs. Default and maximum limits are unchanged.

Accounting version 1 is bound by the existing immutable cursor hash. Older saved states fail with an explicit restart instruction; no old state or lost path is silently revived. True HTTP/read/JSON errors remain failures. No guide audio coverage claim follows from this repair.

Validation read back:
- Focused catalog/reader: 41 tests passed.
- Explicit local regression selection excluding existing live coverage test: 248 tests passed in seven files.
- Wrangler build dry-run passed; metrics disabled. No deployment occurred.
- Typecheck fails at the base in existing test typings. Exact base and candidate output logs are byte-identical (SHA256 d106cf2d33ca2e3a67cfdf736d65afd12b33006abb83df779e8e364552bb4cb7). No new typecheck diagnostic was introduced.
- git diff --check passed.

Validation boundary deviation: an initial full npm test invocation ran the existing coverage.test.ts suite, which made one GitHub org-list request to https://api.github.com/orgs/BibleAquifer/repos?per_page=100. The suite memoizes that response across its two coverage assertions. This violated this dish's no-live-calls instruction. The author discovered it after observing the coverage test duration, immediately disclosed it, and excluded that suite from subsequent local validation. Its result is not accepted evidence for this repair or guide discovery. No provider, MCP scan, source-content request or deployment was performed. The producing error was assuming the default test command was offline; correction is to inspect suite I/O and select local regression files before invocation under a no-network boundary.

Private full logs: /tmp/fia-mcp-residual-plan/{FOCUSED,LOCAL-REGRESSION,TYPECHECK,TYPECHECK-BASELINE,BUILD,ALL-TESTS}.log. Independent exact diff review remains required before publication. Existing public CI includes its own live coverage suite; execution must follow coordinator authority rather than implying it is an offline check.
