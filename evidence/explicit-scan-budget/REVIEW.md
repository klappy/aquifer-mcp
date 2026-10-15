# Explicit catalog scan allowance — candidate

Base: PR32 `3a3d0ca6024891a5b53915aaca3e882b1abd1fe1` in klappy/aquifer-mcp. This extends the existing residual scan repair; it does not replace its accounting or source/cursor validation.

Observed problem: the FIA source inventory at BibleAquifer/FIATranslationGuide revision d8341e423bbb536c1b96402c1957245c3a06c910 reports Spanish Luke JSON2,381,491bytes and Acts2,396,802bytes. Existing plain get returns the Luke article; include_media uses a separate language catalog with a2,000,000byte default. PR32 correctly treats files exceeding the whole allowance as oversized. The internal8,000,000maximum was not exposed by the MCP contract, and sourceCatalog never supplied a larger allowance.

Change: optional scan_max_bytes on get(include_media) and browse, integer1..8,000,000. Default remains2,000,000. The source adapter validates before metadata/storage/source I/O and forwards the allowance to the existing bounded scanner. No new source path, identity, storage namespace, endpoint, format conversion, or deployment configuration is introduced. Callers repeat their explicit allowance on continuation; a previously terminal oversized failure requires a restart without cursor. The allowance is per invocation, not a whole-scan or strict wire-byte bound. Existing delivered-chunk accounting/cancellation behavior remains.

Validation executed locally by author:
-132 tests passed in src/catalog-server.test.ts, src/language-catalog.test.ts, src/tools.test.ts. Synthetic valid JSON bodies match the observed Luke/Acts byte sizes; cold and cached paths preserve file hashes and source identity, reject default oversize, and complete through3MB continuation. Tests also cover invalid limits before I/O, the8MB ceiling, and real handler forwarding for both tools.
- Wrangler dry-run build passed; metrics disabled. No deploy performed.
- Typecheck fails on the existing test-typing baseline. Candidate and exact PR32 baseline logs are byte-identical; no new diagnostic.
- git diff --check passed.

All new source transport tests mock network I/O. No new live MCP or upstream source-content request was executed for this candidate. Existing captured live results informed diagnosis; synthetic tests are not publisher-content or deployed integration proof. Raw Markdown source files remain outside this catalog: formatted get returns headings plus original HTML content, and structured media metadata is JSON. Independent exact candidate review and applicable deployment gates remain required.
