import { describe, it, expect, vi } from "vitest";
import { recordPublicTelemetry, getPublicTelemetrySnapshot } from "./telemetry.js";
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
  });
});
