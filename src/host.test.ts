// S2a probes 2–4 (kitchen rail/2-cooking/2026-09-27-aquifer-stateless-core/SLICES.md § S2a):
// Host/Origin behaviour of the #33 stateless core for the prod host aquifer.klappy.dev.
// Drives the Worker's default export in-process (no network), so the host under test is
// the request URL hostname — the value agents 0.24.0 reads (handler-stateless L265-270).
import { beforeAll, describe, expect, it } from "vitest";

const PROD = "https://aquifer.klappy.dev/mcp";
// aquifer-window origin, named in README.md:26 ("Aquifer Window: https://aquifer-window.klappy.dev").
const WINDOW_ORIGIN = "https://aquifer-window.klappy.dev";
const ACCEPT = "application/json, text/event-stream";

function makeEnv() {
  const kv = new Map<string, string>();
  return {
    WORKER_ENV: "test",
    AQUIFER_CACHE: {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => void kv.set(k, v),
      list: async () => ({ keys: [], list_complete: true, cursor: undefined }),
    },
  } as any;
}
const ctx = { waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}), passThroughOnException() {} } as any;

let worker: { fetch: (r: Request, e: any, c: any) => Promise<Response> };
beforeAll(async () => {
  // Node has no Workers Cache API; AquiferStorage tolerates a missing default cache.
  (globalThis as any).caches ??= { default: undefined, open: async () => undefined };
  worker = (await import("./index.js")).default as any;
});

async function readJsonRpc(res: Response): Promise<any> {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    return line ? JSON.parse(line.slice(6)) : undefined;
  }
  return text ? JSON.parse(text) : undefined;
}

function toolsList2026(url: string, extra: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: ACCEPT, "Mcp-Method": "tools/list", Host: new URL(url).host, ...extra },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "tools/list",
      params: { _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "s2a-probe-cook-aqs2a-probes-2253", version: "0" },
      } },
    }),
  });
}

describe("S2a probe 2 — Host aquifer.klappy.dev", () => {
  it("POST tools/list, _meta 2026-07-28 + Mcp-Method → 200, N=10", async () => {
    const res = await worker.fetch(toolsList2026(PROD), makeEnv(), ctx);
    const body = await readJsonRpc(res);
    const names = (body?.result?.tools ?? []).map((t: any) => t.name);
    console.log(`probe2a ${PROD} tools/list 2026-07-28 → HTTP ${res.status}, N = ${names.length} ${JSON.stringify(names)}${body?.error ? " error=" + JSON.stringify(body.error) : ""}`);
    expect(res.status).toBe(200);
    expect(names.length).toBe(10);
  });

  it("POST initialize protocolVersion 2025-11-25 → 200", async () => {
    const req = new Request(PROD, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: ACCEPT, Host: "aquifer.klappy.dev" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "s2a-probe-cook-aqs2a-probes-2253", version: "0" } },
      }),
    });
    const res = await worker.fetch(req, makeEnv(), ctx);
    const body = await readJsonRpc(res);
    console.log(`probe2b ${PROD} initialize 2025-11-25 → HTTP ${res.status}, result.protocolVersion=${body?.result?.protocolVersion}, serverInfo=${JSON.stringify(body?.result?.serverInfo)}`);
    expect(res.status).toBe(200);
    expect(body?.result?.protocolVersion).toBe("2025-11-25");
  });
});

describe("S2a probe 3 — Host evil.example (config @0713f89: allowedHostnames unset)", () => {
  it("is NOT rejected: agents 0.24.0 runs no Host check for a non-localhost, non-*.workers.dev host → 200", async () => {
    const res = await worker.fetch(toolsList2026("https://evil.example/mcp"), makeEnv(), ctx);
    const body = await readJsonRpc(res);
    console.log(`probe3 https://evil.example/mcp (Host: evil.example) tools/list → HTTP ${res.status}, N = ${(body?.result?.tools ?? []).length} — outcome of current config (no allowedHostnames ⇒ no Host check), not a 403`);
    expect(res.status).toBe(200);
  });
});

describe("S2a probe 4 — Origin aquifer-window", () => {
  it(`Origin: ${WINDOW_ORIGIN} → 200 with access-control-allow-origin`, async () => {
    const res = await worker.fetch(toolsList2026(PROD, { Origin: WINDOW_ORIGIN }), makeEnv(), ctx);
    const acao = res.headers.get("access-control-allow-origin");
    const body = await readJsonRpc(res);
    console.log(`probe4 ${PROD} Origin: ${WINDOW_ORIGIN} → HTTP ${res.status}, access-control-allow-origin: ${acao}, N = ${(body?.result?.tools ?? []).length}`);
    expect(res.status).toBe(200);
    expect(acao).toBeTruthy();
  });
});
