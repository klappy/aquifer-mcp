import { describe, it, expect, vi } from "vitest";
import { recordPublicTelemetry, getPublicTelemetrySnapshot, classifySearchType, passageHierarchy } from "./telemetry.js";
import type { Env } from "./types.js";

function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const val = store.get(key);
      if (!val) return null;
      return type === "json" ? JSON.parse(val) : val;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async () => {}),
    list: vi.fn(async (options?: { prefix?: string; limit?: number; cursor?: string }) => {
      const prefix = options?.prefix ?? "";
      const limit = options?.limit ?? 1000;
      const allKeys = Array.from(store.keys())
        .filter((key) => key.startsWith(prefix))
        .sort();
      const offset = Number(options?.cursor ?? "0");
      const pageKeys = allKeys.slice(offset, offset + limit).map((name) => ({ name }));
      const nextOffset = offset + pageKeys.length;
      const listComplete = nextOffset >= allKeys.length;
      return {
        keys: pageKeys,
        list_complete: listComplete,
        cursor: listComplete ? "" : String(nextOffset),
        cacheStatus: null,
      };
    }),
    getWithMetadata: vi.fn(async () => ({ value: null, metadata: null, cacheStatus: null })),
  } as unknown as KVNamespace;
}

function createEnv(overrides?: Partial<Env>): Env {
  return {
    AQUIFER_CACHE: createMockKV(),
    AQUIFER_ORG: "BibleAquifer",
    DOCS_REPO: "docs",
    WORKER_ENV: "production",
    ...overrides,
  };
}

describe("recordPublicTelemetry", () => {
  it("records tools/call counts for explicit client label", async () => {
    const env = createEnv({ TELEMETRY_VERIFIED_CLIENTS: "Cursor" });
    const request = new Request("https://aquifer.klappy.dev/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aquifer-client": "Cursor",
        "x-aquifer-client-version": "1.2.3",
        "x-aquifer-agent-name": "CursorAgent",
        "x-aquifer-agent-version": "5.3",
        "x-aquifer-surface": "mcp-client",
        "x-aquifer-contact-url": "https://example.org/contact",
        "x-aquifer-policy-url": "https://example.org/policy",
        "x-aquifer-capabilities": "list,search,get,related,browse",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search", arguments: { query: "Romans 3:24" } },
      }),
    });

    await recordPublicTelemetry(request, env);
    const snapshot = await getPublicTelemetrySnapshot(env, 10);

    expect(snapshot.totals.mcp_requests).toBe(1);
    expect(snapshot.totals.tool_calls).toBe(1);
    expect(snapshot.leaderboards.consumers[0]?.name).toBe("Cursor");
    expect(snapshot.leaderboards.consumers_weighted[0]?.name).toBe("Cursor");
    expect(snapshot.leaderboards.consumers_weighted[0]?.calls).toBe(10);
    expect(snapshot.leaderboards.transparency[0]?.name).toBe("Cursor");
    expect(snapshot.leaderboards.transparency[0]?.completeness_pct).toBe(100);
    expect(snapshot.leaderboards.transparency[0]?.badge).toBe("Open Ledger");
    expect(snapshot.leaderboards.tools[0]?.name).toBe("search");
    expect(snapshot.consumer_label_sources[0]?.name).toBe("x-aquifer-client");
    expect(snapshot.consumer_verification_counts.some((v) => v.name === "verified" && v.calls === 1)).toBe(true);
    expect(snapshot.self_report_field_counts.some((f) => f.name === "policy_url" && f.calls === 1)).toBe(true);
    expect(snapshot.search_type_counts.some((s) => s.name === "passage" && s.calls === 1)).toBe(true);
    expect(snapshot.passage_counts.testaments.some((t) => t.name === "nt" && t.calls === 1)).toBe(true);
    expect(snapshot.passage_counts.books.some((b) => b.name === "45" && b.calls === 1)).toBe(true);
    expect(snapshot.passage_counts.chapters.some((c) => c.name === "45003" && c.calls === 1)).toBe(true);
    expect(snapshot.passage_counts.verses.some((v) => v.name === "45003024" && v.calls === 1)).toBe(true);
    expect(snapshot.last_recorded_at).toBeTruthy();
  });

  it("records batch requests and initialize clientInfo label source", async () => {
    const env = createEnv();
    const request = new Request("https://aquifer.klappy.dev/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify([
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { clientInfo: { name: "ClaudeDesktop", version: "1.0" } },
        },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get", arguments: { resource_code: "BiblicaStudyNotes", language: "eng", content_id: "1" } },
        },
      ]),
    });

    await recordPublicTelemetry(request, env);
    const snapshot = await getPublicTelemetrySnapshot(env, 10);

    expect(snapshot.totals.mcp_requests).toBe(2);
    expect(snapshot.totals.tool_calls).toBe(1);
    expect(snapshot.method_counts.some((m) => m.name === "initialize" && m.calls === 1)).toBe(true);
    expect(snapshot.method_counts.some((m) => m.name === "tools/call" && m.calls === 1)).toBe(true);
    expect(snapshot.leaderboards.consumers[0]?.name).toBe("ClaudeDesktop");
    expect(snapshot.leaderboards.consumers_weighted[0]?.calls).toBe(1);
    expect(snapshot.leaderboards.transparency[0]?.completeness_pct).toBe(25);
    expect(snapshot.consumer_label_sources[0]?.name).toBe("initialize.clientInfo.name");
    expect(snapshot.consumer_verification_counts.some((v) => v.name === "unverified" && v.calls === 1)).toBe(true);
    expect(snapshot.leaderboards.resources[0]?.name).toBe("BiblicaStudyNotes");
    expect(snapshot.leaderboards.resources[0]?.calls).toBe(1);
    expect(snapshot.leaderboards.languages[0]?.name).toBe("eng");
    expect(snapshot.leaderboards.languages[0]?.calls).toBe(1);
    expect(snapshot.leaderboards.articles[0]?.name).toBe("BiblicaStudyNotes:eng:1");
    expect(snapshot.leaderboards.articles[0]?.calls).toBe(1);
    expect(snapshot.last_article).not.toBeNull();
    expect(snapshot.last_article?.resource_code).toBe("BiblicaStudyNotes");
    expect(snapshot.last_article?.language).toBe("eng");
    expect(snapshot.last_article?.content_id).toBe("1");
    expect(snapshot.last_article?.tool).toBe("get");
  });

  it("tracks resource and language for browse tool without article", async () => {
    const env = createEnv();
    const request = new Request("https://aquifer.klappy.dev/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "browse", arguments: { resource_code: "UbsImages", language: "eng" } },
      }),
    });

    await recordPublicTelemetry(request, env);
    const snapshot = await getPublicTelemetrySnapshot(env, 10);

    expect(snapshot.leaderboards.resources[0]?.name).toBe("UbsImages");
    expect(snapshot.leaderboards.languages[0]?.name).toBe("eng");
    expect(snapshot.leaderboards.articles).toHaveLength(0);
    expect(snapshot.last_article).toBeNull();
  });

  it("tracks search type for entity queries", async () => {
    const env = createEnv();
    const request = new Request("https://aquifer.klappy.dev/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search", arguments: { query: "keyterm:Justification" } },
      }),
    });

    await recordPublicTelemetry(request, env);
    const snapshot = await getPublicTelemetrySnapshot(env, 10);

    expect(snapshot.search_type_counts.some((s) => s.name === "entity" && s.calls === 1)).toBe(true);
  });

  it("tracks search type for title queries", async () => {
    const env = createEnv();
    const request = new Request("https://aquifer.klappy.dev/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search", arguments: { query: "Justification" } },
      }),
    });

    await recordPublicTelemetry(request, env);
    const snapshot = await getPublicTelemetrySnapshot(env, 10);

    expect(snapshot.search_type_counts.some((s) => s.name === "title" && s.calls === 1)).toBe(true);
  });

  it("accumulates resource and article counts across multiple calls", async () => {
    const env = createEnv();

    for (let i = 0; i < 3; i++) {
      const request = new Request("https://aquifer.klappy.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: i,
          method: "tools/call",
          params: { name: "get", arguments: { resource_code: "TyndaleStudyNotes", language: "eng", content_id: "42" } },
        }),
      });
      await recordPublicTelemetry(request, env);
    }

    const snapshot = await getPublicTelemetrySnapshot(env, 10);

    expect(snapshot.leaderboards.resources[0]?.name).toBe("TyndaleStudyNotes");
    expect(snapshot.leaderboards.resources[0]?.calls).toBe(3);
    expect(snapshot.leaderboards.articles[0]?.name).toBe("TyndaleStudyNotes:eng:42");
    expect(snapshot.leaderboards.articles[0]?.calls).toBe(3);
    expect(snapshot.last_article?.content_id).toBe("42");
  });
});

describe("classifySearchType", () => {
  it("classifies passage references", () => {
    expect(classifySearchType("Romans 3:24")).toBe("passage");
    expect(classifySearchType("ROM 3:24")).toBe("passage");
    expect(classifySearchType("Gen 1:1")).toBe("passage");
    expect(classifySearchType("45003024")).toBe("passage");
    expect(classifySearchType("1 John 3:16")).toBe("passage");
  });

  it("classifies entity queries", () => {
    expect(classifySearchType("keyterm:Justification")).toBe("entity");
    expect(classifySearchType("person:Paul")).toBe("entity");
    expect(classifySearchType("place:Jerusalem")).toBe("entity");
  });

  it("classifies title queries", () => {
    expect(classifySearchType("Justification")).toBe("title");
    expect(classifySearchType("grace and mercy")).toBe("title");
    expect(classifySearchType("Introduction to Romans")).toBe("title");
  });
});

describe("passageHierarchy", () => {
  it("decomposes a verse into all levels", () => {
    const result = passageHierarchy("45003024");
    expect(result).toEqual({
      verse: "45003024",
      chapter: "45003",
      book: "45",
      testament: "nt",
    });
  });

  it("decomposes an OT reference", () => {
    const result = passageHierarchy("01001001");
    expect(result).toEqual({
      verse: "01001001",
      chapter: "01001",
      book: "01",
      testament: "ot",
    });
  });

  it("uses start of range for ranges", () => {
    const result = passageHierarchy("45003021-45003026");
    expect(result).toEqual({
      verse: "45003021",
      chapter: "45003",
      book: "45",
      testament: "nt",
    });
  });

  it("returns null for invalid references", () => {
    expect(passageHierarchy("invalid")).toBeNull();
    expect(passageHierarchy("99001001")).toBeNull();
    expect(passageHierarchy("00001001")).toBeNull();
  });

  it("correctly classifies OT/NT boundary", () => {
    expect(passageHierarchy("39001001")?.testament).toBe("ot");
    expect(passageHierarchy("40001001")?.testament).toBe("nt");
    expect(passageHierarchy("66022021")?.testament).toBe("nt");
  });
});

describe("passage hierarchy telemetry recording", () => {
  it("records hierarchical counters for passage searches", async () => {
    const env = createEnv();
    const request = new Request("https://aquifer.klappy.dev/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search", arguments: { query: "Romans 3:24" } },
      }),
    });

    await recordPublicTelemetry(request, env);
    const snapshot = await getPublicTelemetrySnapshot(env, 10);

    expect(snapshot.passage_counts.testaments).toHaveLength(1);
    expect(snapshot.passage_counts.testaments[0]).toEqual({ name: "nt", calls: 1 });
    expect(snapshot.passage_counts.books[0]).toEqual({ name: "45", calls: 1 });
    expect(snapshot.passage_counts.chapters[0]).toEqual({ name: "45003", calls: 1 });
    expect(snapshot.passage_counts.verses[0]).toEqual({ name: "45003024", calls: 1 });
  });

  it("accumulates across multiple passage searches in the same book", async () => {
    const env = createEnv();

    for (const query of ["Romans 3:24", "ROM 3:21", "Romans 5:1"]) {
      const request = new Request("https://aquifer.klappy.dev/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "search", arguments: { query } },
        }),
      });
      await recordPublicTelemetry(request, env);
    }

    const snapshot = await getPublicTelemetrySnapshot(env, 10);

    expect(snapshot.passage_counts.testaments[0]).toEqual({ name: "nt", calls: 3 });
    expect(snapshot.passage_counts.books[0]).toEqual({ name: "45", calls: 3 });
    const ch3 = snapshot.passage_counts.chapters.find((c) => c.name === "45003");
    const ch5 = snapshot.passage_counts.chapters.find((c) => c.name === "45005");
    expect(ch3?.calls).toBe(2);
    expect(ch5?.calls).toBe(1);
  });

  it("does not record passage hierarchy for entity searches", async () => {
    const env = createEnv();
    const request = new Request("https://aquifer.klappy.dev/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "search", arguments: { query: "keyterm:Justification" } },
      }),
    });

    await recordPublicTelemetry(request, env);
    const snapshot = await getPublicTelemetrySnapshot(env, 10);

    expect(snapshot.passage_counts.testaments).toHaveLength(0);
    expect(snapshot.passage_counts.books).toHaveLength(0);
  });
});
