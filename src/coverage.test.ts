import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ManifestEntry {
  status: "served" | "pending" | "excluded";
  primary_language?: string;
  aquifer_type?: string;
  reason?: string;
  metadata_valid?: boolean;
  metadata_size_mb?: number;
}

interface Manifest {
  _served_floor: number;
  _audited: string;
  repos: Record<string, ManifestEntry>;
}

const MANIFEST_PATH = resolve(__dirname, "../schemas/resource-manifest.json");
const ORG_API = "https://api.github.com/orgs/BibleAquifer/repos?per_page=100";

function loadManifest(): Manifest {
  const raw = readFileSync(MANIFEST_PATH, "utf-8");
  return JSON.parse(raw) as Manifest;
}

async function fetchOrgRepoNames(): Promise<string[]> {
  const resp = await fetch(ORG_API, {
    headers: {
      "User-Agent": "aquifer-mcp-ci",
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`);
  const repos = (await resp.json()) as Array<{ name: string }>;
  return repos.map((r) => r.name);
}

describe("resource coverage manifest", () => {
  it("is valid JSON with required structure", () => {
    const m = loadManifest();
    expect(m._served_floor).toBeGreaterThan(0);
    expect(typeof m._served_floor).toBe("number");
    expect(Number.isInteger(m._served_floor)).toBe(true);
    expect(Object.keys(m.repos).length).toBeGreaterThan(0);

    const validStatuses = ["served", "pending", "excluded"];
    for (const [name, entry] of Object.entries(m.repos)) {
      expect(
        validStatuses,
        `Invalid status "${entry.status}" for repo "${name}"`,
      ).toContain(entry.status);

      // Pending entries must have a reason
      if (entry.status === "pending") {
        expect(
          entry.reason,
          `Pending repo "${name}" is missing a reason`,
        ).toBeTruthy();
      }

      // Excluded entries must have a reason
      if (entry.status === "excluded") {
        expect(
          entry.reason,
          `Excluded repo "${name}" is missing a reason`,
        ).toBeTruthy();
      }
    }
  });

  it("served count meets or exceeds floor (ratchet)", () => {
    const m = loadManifest();
    const servedCount = Object.values(m.repos).filter(
      (e) => e.status === "served",
    ).length;
    expect(
      servedCount,
      `Served count ${servedCount} is below floor ${m._served_floor}. ` +
        `The served floor is a ratchet — it can only increase. ` +
        `If a resource was intentionally removed, update _served_floor with justification.`,
    ).toBeGreaterThanOrEqual(m._served_floor);
  });

  it(
    "every org repo is categorized in manifest",
    async () => {
      const m = loadManifest();
      const orgRepos = await fetchOrgRepoNames();

      // Safety: if org exceeds 100 repos, we need pagination
      expect(
        orgRepos.length,
        "BibleAquifer org may have exceeded 100 repos — add pagination to fetchOrgRepoNames",
      ).toBeLessThanOrEqual(100);

      const uncategorized = orgRepos.filter((name) => !(name in m.repos));
      expect(
        uncategorized,
        `Uncategorized repos found in BibleAquifer org: ${uncategorized.join(", ")}. ` +
          `Add each to schemas/resource-manifest.json as "served", "pending", or "excluded".`,
      ).toHaveLength(0);
    },
    15_000,
  );

  it(
    "no phantom entries in manifest",
    async () => {
      const m = loadManifest();
      const orgRepos = new Set(await fetchOrgRepoNames());
      const phantoms = Object.keys(m.repos).filter(
        (name) => !orgRepos.has(name),
      );
      expect(
        phantoms,
        `Phantom entries in manifest (repos no longer in org): ${phantoms.join(", ")}. ` +
          `Remove or update these entries.`,
      ).toHaveLength(0);
    },
    15_000,
  );
});
