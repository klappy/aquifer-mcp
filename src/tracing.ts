/**
 * Lightweight edge-compatible request tracer for X-Ray performance diagnostics.
 *
 * Modeled on translation-helps-mcp's EdgeXRayTracer, adapted for Aquifer's
 * three-tier storage (Memory → Cache API → R2) + fan-out query pattern.
 *
 * Usage: create one RequestTracer per inbound request, thread it through
 * storage reads and fan-out functions, then serialize via toHeader() or toJSON().
 */

export interface TraceSpan {
  label: string;
  duration_ms: number;
  source?: "memory" | "cache" | "r2" | "kv" | "github" | "miss";
  detail?: string;
}

export class RequestTracer {
  private spans: TraceSpan[] = [];
  private startTime: number;

  constructor() {
    this.startTime = performance.now();
  }

  /** Record a span with explicit timing, source, and detail. */
  addSpan(label: string, duration_ms: number, source?: TraceSpan["source"], detail?: string): void {
    this.spans.push({
      label,
      duration_ms,
      ...(source ? { source } : {}),
      ...(detail ? { detail } : {}),
    });
  }

  /** Total elapsed time since tracer creation. */
  get elapsed_ms(): number {
    return Math.round(performance.now() - this.startTime);
  }

  /** Compact header value for X-Aquifer-Trace. */
  toHeader(): string {
    const parts = this.spans.map((s) => {
      let val = `${s.label}=${s.duration_ms}ms`;
      if (s.source) val += `(${s.source})`;
      if (s.detail) val += `[${s.detail}]`;
      return val;
    });
    parts.push(`total=${this.elapsed_ms}ms`);
    return parts.join(", ");
  }

  /** Structured JSON for metadata inclusion. */
  toJSON(): { spans: TraceSpan[]; total_ms: number } {
    return { spans: [...this.spans], total_ms: this.elapsed_ms };
  }
}

/** Shorten an R2/cache key for readable trace output. */
export function shortKey(key: string): string {
  const parts = key.split("/");
  if (parts.length <= 2) return key;
  // "index/abc123def/navigability.json" → "index/abc123.../navigabi..."
  const mid = parts.slice(1, -1).map((p) => (p.length > 8 ? p.slice(0, 8) + "…" : p)).join("/");
  const last = parts[parts.length - 1]!;
  const shortLast = last.length > 10 ? last.slice(0, 10) + "…" : last;
  return `${parts[0]}/${mid}/${shortLast}`;
}
