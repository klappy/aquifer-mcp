import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  handleList,
  handleSearch,
  handleGet,
  handleRelated,
  handleBrowse,
  handleReadme,
  handleTelemetryPolicy,
  handleTelemetryPublic,
  handleScripture,
  handleEntity,
} from "./tools.js";
import type { Env, NavigabilityIndex, ResourceEntry, ArticleRef, ArticleContent, ResourceMetadata } from "./types.js";
import type { AquiferStorage } from "./storage.js";

// --- Mock AquiferStorage ---

function createMockStorage(): AquiferStorage {
  const store = new Map<string, string>();
  return {
    getJSON: vi.fn(async (key: string) => {
      const val = store.get(key);
      if (!val) return { data: null, source: "miss" as const };
      return { data: JSON.parse(val), source: "memory" as const };
    }),
    putJSON: vi.fn(async (key: string, data: unknown) => {
      store.set(key, JSON.stringify(data));
      return true;
    }),
  } as unknown as AquiferStorage;
}

// --- Mock KV store ---

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

// --- Fixtures ---

const STUDY_NOTES_ENTRY: ResourceEntry = {
  resource_code: "BiblicaStudyNotes",
  aquifer_type: "StudyNotes",
  resource_type: "Study Notes",
  title: "Biblica Study Notes",
  short_name: "BSN",
  order: "canonical",
  language: "eng",
  localizations: ["spa", "fra"],
  article_count: 751,
  version: "1.1.2",
};

const FIA_MAPS_ENTRY: ResourceEntry = {
  resource_code: "FIAMaps",
  aquifer_type: "Images",
  resource_type: "Images, Maps, Videos",
  title: "Familiarization, Internalization, Articulation (FIA) Maps",
  short_name: "FIAMaps",
  order: "alphabetical",
  language: "eng",
  localizations: [],
  article_count: 206,
  version: "1.0.0",
};

const BIBLE_ENTRY: ResourceEntry = {
  resource_code: "BiblicaBible",
  aquifer_type: "Bible",
  resource_type: "Bible",
  title: "Biblica Bible",
  short_name: "BB",
  order: "canonical",
  language: "eng",
  localizations: [],
  article_count: 66,
  version: "1.0.0",
};

const BIBLE_ARTICLE: ArticleContent = {
  content_id: "500001",
  reference_id: 200001,
  version: "1.0.0",
  title: "Romans 3:21-26",
  media_type: "Text",
  index_reference: "45003021-45003026",
  language: "eng",
  review_level: "None",
  content: "<p>But now apart from the law the righteousness of God has been made known.</p><p>For all have sinned and fall short of the glory of God.</p>",
  associations: {
    passage: [
      { start_ref: "45003021", start_ref_usfm: "ROM 3:21", end_ref: "45003026", end_ref_usfm: "ROM 3:26" },
    ],
    resource: [],
    acai: [],
  },
};

const ROMANS_ARTICLE_REF: ArticleRef = {
  resource_code: "BiblicaStudyNotes",
  language: "eng",
  content_id: "132828",
  title: "Romans 1:1–17",
  resource_type: "Study Notes",
  index_reference: "45001001-45001017",
};

const ROMANS_ARTICLE: ArticleContent = {
  content_id: "132828",
  reference_id: 108882,
  version: "1.0.2",
  title: "Romans 1:1–17",
  media_type: "Text",
  index_reference: "45001001-45001017",
  language: "eng",
  review_level: "None",
  content: "<p>Paul longed to see the believers in Rome.</p>",
  associations: {
    passage: [
      { start_ref: "45001001", start_ref_usfm: "ROM 1:1", end_ref: "45001017", end_ref_usfm: "ROM 1:17" },
    ],
    resource: [
      { reference_id: 108043, content_id: 131989, resource_code: "BiblicaStudyNotesKeyTerms", label: "Good news", language: "eng" },
    ],
    acai: [
      { id: "person:Paul", type: "person", preferred_label: "Paul", confidence: 0.95, match_method: "exact" },
    ],
  },
};

const MAP_ARTICLE: ArticleContent = {
  content_id: "368172",
  reference_id: 100001,
  version: "1.0.0",
  title: "Abram's Journey from Ur to Canaan",
  media_type: "Image",
  index_reference: "abram's journey from ur to canaan",
  language: "eng",
  review_level: "None",
  content: "<h3>Image Content</h3><img src='https://cdn.aquifer.bible/aquifer-content/resources/FIAMaps/c37-abrams-journey.png' />",
  associations: {
    passage: [
      { start_ref: "01011027", start_ref_usfm: "GEN 11:27", end_ref: "01011032", end_ref_usfm: "GEN 11:32" },
    ],
    resource: [],
    acai: [
      { id: "person:Abraham", type: "person", preferred_label: "Abraham", confidence: 0.9, match_method: "exact" },
    ],
  },
};

const MAP_ARTICLE_2: ArticleContent = {
  content_id: "869852",
  reference_id: 100002,
  version: "1.0.0",
  title: "Aerial View of Judea and Jerusalem",
  media_type: "Image",
  index_reference: "aerial view of judea and jerusalem",
  language: "eng",
  review_level: "None",
  content: "<h3>Image Content</h3><img src='https://cdn.aquifer.bible/aquifer-content/resources/FIAMaps/c201-aerial-view.png' />",
  associations: {
    passage: [{ start_ref: "41001001", start_ref_usfm: "MRK 1:1", end_ref: "41001013", end_ref_usfm: "MRK 1:13" }],
    resource: [],
    acai: [],
  },
};

function buildMockIndex(entries: ResourceEntry[], passageEntries?: [string, ArticleRef[]][]): NavigabilityIndex {
  const repoShas = new Map<string, string>();
  for (const e of entries) repoShas.set(e.resource_code, "abc123test");
  return {
    registry: entries,
    passage: new Map(passageEntries ?? [["45001001-45001017", [ROMANS_ARTICLE_REF]]]),
    entity: new Map([["person:paul", [ROMANS_ARTICLE_REF]]]),
    title: [
      ROMANS_ARTICLE_REF,
      { resource_code: "FIAMaps", language: "eng", content_id: "368172", title: "Abram's Journey from Ur to Canaan", resource_type: "Images, Maps, Videos" },
    ],
    built_at: Date.now(),
    composite_sha: "mock_composite_sha",
    repo_shas: repoShas,
  };
}

// --- Mock modules ---

// We mock the registry and github modules to control what data the tools see.
vi.mock("./registry.js", () => ({
  getOrBuildIndex: vi.fn(),
}));

vi.mock("./github.js", () => ({
  metadataUrl: vi.fn((org: string, code: string, lang: string) => `https://raw.githubusercontent.com/${org}/${code}/main/${lang}/metadata.json`),
  contentUrl: vi.fn((org: string, code: string, lang: string, file: string) => `https://raw.githubusercontent.com/${org}/${code}/main/${lang}/json/${file}`),
  fetchJson: vi.fn(),
  GC_TTL: 2592000,
}));

import { getOrBuildIndex } from "./registry.js";
import { fetchJson } from "./github.js";

const mockGetOrBuildIndex = vi.mocked(getOrBuildIndex);
const mockFetchJson = vi.mocked(fetchJson);

// --- Tests ---

describe("handleList", () => {
  let env: Env;
  let storage: AquiferStorage;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_CONTENT: {} as R2Bucket, AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs", WORKER_ENV: "production" };
    storage = createMockStorage();
    mockGetOrBuildIndex.mockResolvedValue(buildMockIndex([STUDY_NOTES_ENTRY, FIA_MAPS_ENTRY]));
  });

  it("returns all resources when no filters", async () => {
    const result = await handleList({}, env, storage);
    expect(result.content[0]!.text).toContain("Found 2 resource(s)");
    expect(result.content[0]!.text).toContain("Biblica Study Notes");
    expect(result.content[0]!.text).toContain("FIAMaps");
  });

  it("filters by type", async () => {
    const result = await handleList({ type: "Images" }, env, storage);
    expect(result.content[0]!.text).toContain("Found 1 resource(s)");
    expect(result.content[0]!.text).toContain("FIAMaps");
    expect(result.content[0]!.text).not.toContain("Biblica Study Notes");
  });

  it("filters by language", async () => {
    const result = await handleList({ language: "spa" }, env, storage);
    expect(result.content[0]!.text).toContain("Found 1 resource(s)");
    expect(result.content[0]!.text).toContain("Biblica Study Notes");
  });

  it("returns message when no match", async () => {
    const result = await handleList({ type: "NonExistent" }, env, storage);
    expect(result.content[0]!.text).toContain("No resources found");
  });
});

describe("handleSearch", () => {
  let env: Env;
  let storage: AquiferStorage;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_CONTENT: {} as R2Bucket, AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs", WORKER_ENV: "production" };
    storage = createMockStorage();
    mockGetOrBuildIndex.mockResolvedValue(buildMockIndex([STUDY_NOTES_ENTRY, FIA_MAPS_ENTRY]));
    mockFetchJson.mockResolvedValue(null);
  });

  it("requires a query", async () => {
    const result = await handleSearch({}, env, storage);
    expect(result.content[0]!.text).toContain("Please provide a search query");
  });

  it("searches by passage reference", async () => {
    const result = await handleSearch({ query: "ROM 1:1" }, env, storage);
    expect(result.content[0]!.text).toContain("Romans 1:1–17");
  });

  it("searches by human-readable reference", async () => {
    const result = await handleSearch({ query: "Romans 1:5" }, env, storage);
    expect(result.content[0]!.text).toContain("Romans 1:1–17");
  });

  it("returns no results for uncovered passage", async () => {
    const result = await handleSearch({ query: "REV 22:21" }, env, storage);
    expect(result.content[0]!.text).toContain("No articles found for passage");
  });

  it("searches by keyword", async () => {
    const result = await handleSearch({ query: "Abram" }, env, storage);
    expect(result.content[0]!.text).toContain("Abram's Journey");
  });

  it("returns no results for unmatched keyword", async () => {
    const result = await handleSearch({ query: "xyznonexistent" }, env, storage);
    expect(result.content[0]!.text).toContain("No articles found matching");
  });
});

describe("handleGet", () => {
  let env: Env;
  let storage: AquiferStorage;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_CONTENT: {} as R2Bucket, AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs", WORKER_ENV: "production" };
    storage = createMockStorage();
    mockGetOrBuildIndex.mockResolvedValue(buildMockIndex([STUDY_NOTES_ENTRY]));
  });

  it("requires all three fields", async () => {
    const result = await handleGet({ resource_code: "BiblicaStudyNotes" }, env, storage);
    expect(result.content[0]!.text).toContain("Missing required fields");
  });

  it("returns error for unknown resource", async () => {
    const result = await handleGet({ resource_code: "NonExistent", language: "eng", content_id: "123" }, env, storage);
    expect(result.content[0]!.text).toContain("not found in the registry");
  });

  it("fetches and returns article content", async () => {
    // Mock metadata with ingredients
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("metadata.json")) {
        return {
          resource_metadata: STUDY_NOTES_ENTRY,
          scripture_burrito: { ingredients: { "json/45.content.json": {} } },
          article_metadata: {
            "132828": { content_id: "132828", reference_id: 108882, index_reference: "45001001-45001017" },
          },
        } as ResourceMetadata;
      }
      if (url.includes("45.content.json")) {
        return [ROMANS_ARTICLE];
      }
      return null;
    });

    const result = await handleGet({ resource_code: "BiblicaStudyNotes", language: "eng", content_id: "132828" }, env, storage);
    const text = result.content[0]!.text;
    expect(text).toContain("Romans 1:1–17");
    expect(text).toContain("Paul longed to see the believers");
    expect(text).toContain("ROM 1:1");
    expect(text).toContain("Good news");
    expect(text).toContain("person:Paul");
  });

  it("returns not-found for missing article", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("metadata.json")) {
        return {
          resource_metadata: STUDY_NOTES_ENTRY,
          scripture_burrito: { ingredients: { "json/45.content.json": {} } },
          article_metadata: {},
        } as ResourceMetadata;
      }
      if (url.includes("content.json")) return [ROMANS_ARTICLE];
      return null;
    });

    const result = await handleGet({ resource_code: "BiblicaStudyNotes", language: "eng", content_id: "999999" }, env, storage);
    expect(result.content[0]!.text).toContain("not found");
  });
});

describe("handleRelated", () => {
  let env: Env;
  let storage: AquiferStorage;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_CONTENT: {} as R2Bucket, AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs", WORKER_ENV: "production" };
    storage = createMockStorage();
    const otherRef: ArticleRef = {
      resource_code: "AquiferOpenStudyNotes",
      language: "eng",
      content_id: "999",
      title: "Romans 1:1-17 (Open)",
      resource_type: "Study Notes",
      index_reference: "45001001-45001017",
    };
    mockGetOrBuildIndex.mockResolvedValue(
      buildMockIndex([STUDY_NOTES_ENTRY], [["45001001-45001017", [ROMANS_ARTICLE_REF, otherRef]]]),
    );
  });

  it("requires all three fields", async () => {
    const result = await handleRelated({ resource_code: "BiblicaStudyNotes" }, env, storage);
    expect(result.content[0]!.text).toContain("Missing required fields");
  });

  it("finds passage-overlapping articles", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("metadata.json")) {
        return {
          resource_metadata: STUDY_NOTES_ENTRY,
          scripture_burrito: { ingredients: { "json/45.content.json": {} } },
          article_metadata: {
            "132828": { content_id: "132828", reference_id: 108882, index_reference: "45001001-45001017" },
          },
        } as ResourceMetadata;
      }
      if (url.includes("content.json")) return [ROMANS_ARTICLE];
      return null;
    });

    const result = await handleRelated(
      { resource_code: "BiblicaStudyNotes", language: "eng", content_id: "132828" },
      env,
      storage,
    );
    const text = result.content[0]!.text;
    expect(text).toContain("Passage overlap");
    expect(text).toContain("Romans 1:1-17 (Open)");
  });
});

describe("handleBrowse", () => {
  let env: Env;
  let storage: AquiferStorage;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_CONTENT: {} as R2Bucket, AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs", WORKER_ENV: "production" };
    storage = createMockStorage();
    mockGetOrBuildIndex.mockResolvedValue(buildMockIndex([STUDY_NOTES_ENTRY, FIA_MAPS_ENTRY]));
  });

  it("requires resource_code", async () => {
    const result = await handleBrowse({}, env, storage);
    expect(result.content[0]!.text).toContain("Missing required field: resource_code");
  });

  it("returns error for unknown resource", async () => {
    const result = await handleBrowse({ resource_code: "NonExistent" }, env, storage);
    expect(result.content[0]!.text).toContain("not found in the registry");
  });

  it("returns paginated catalog for media resource", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("metadata.json")) {
        return {
          resource_metadata: FIA_MAPS_ENTRY,
          scripture_burrito: {
            ingredients: { "json/001.content.json": {}, "json/002.content.json": {} },
          },
          article_metadata: {},
        } as ResourceMetadata;
      }
      if (url.includes("001.content.json")) return [MAP_ARTICLE];
      if (url.includes("002.content.json")) return [MAP_ARTICLE_2];
      return null;
    });

    const result = await handleBrowse({ resource_code: "FIAMaps" }, env, storage);
    const text = result.content[0]!.text;
    expect(text).toContain("FIAMaps/eng");
    expect(text).toContain("2 articles total");
    expect(text).toContain("Abram's Journey from Ur to Canaan");
    expect(text).toContain("Aerial View of Judea and Jerusalem");
    expect(text).toContain("cdn.aquifer.bible");
    expect(text).toContain("GEN 11:27");
  });

  it("paginates correctly", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("metadata.json")) {
        return {
          resource_metadata: FIA_MAPS_ENTRY,
          scripture_burrito: {
            ingredients: { "json/001.content.json": {}, "json/002.content.json": {} },
          },
          article_metadata: {},
        } as ResourceMetadata;
      }
      if (url.includes("001.content.json")) return [MAP_ARTICLE];
      if (url.includes("002.content.json")) return [MAP_ARTICLE_2];
      return null;
    });

    // page_size=1 → 2 pages
    const page1 = await handleBrowse({ resource_code: "FIAMaps", page_size: 1 }, env, storage);
    expect(page1.content[0]!.text).toContain("page 1/2");
    expect(page1.content[0]!.text).toContain("Abram's Journey");
    expect(page1.content[0]!.text).toContain("Use page=2 to see more");

    const page2 = await handleBrowse({ resource_code: "FIAMaps", page_size: 1, page: 2 }, env, storage);
    expect(page2.content[0]!.text).toContain("page 2/2");
    expect(page2.content[0]!.text).toContain("Aerial View");
    expect(page2.content[0]!.text).not.toContain("Use page=3");
  });

  it("returns error for out-of-range page", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("metadata.json")) {
        return {
          resource_metadata: FIA_MAPS_ENTRY,
          scripture_burrito: { ingredients: { "json/001.content.json": {} } },
          article_metadata: {},
        } as ResourceMetadata;
      }
      if (url.includes("001.content.json")) return [MAP_ARTICLE];
      return null;
    });

    const result = await handleBrowse({ resource_code: "FIAMaps", page: 99 }, env, storage);
    expect(result.content[0]!.text).toContain("out of range");
  });

  it("extracts image URLs from content HTML", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("metadata.json")) {
        return {
          resource_metadata: FIA_MAPS_ENTRY,
          scripture_burrito: { ingredients: { "json/001.content.json": {} } },
          article_metadata: {},
        } as ResourceMetadata;
      }
      if (url.includes("001.content.json")) return [MAP_ARTICLE];
      return null;
    });

    const result = await handleBrowse({ resource_code: "FIAMaps" }, env, storage);
    const text = result.content[0]!.text;
    expect(text).toContain("https://cdn.aquifer.bible/aquifer-content/resources/FIAMaps/c37-abrams-journey.png");
  });

  it("defaults language to eng", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("metadata.json")) {
        return {
          resource_metadata: FIA_MAPS_ENTRY,
          scripture_burrito: { ingredients: { "json/001.content.json": {} } },
          article_metadata: {},
        } as ResourceMetadata;
      }
      if (url.includes("001.content.json")) return [MAP_ARTICLE];
      return null;
    });

    const result = await handleBrowse({ resource_code: "FIAMaps" }, env, storage);
    expect(result.content[0]!.text).toContain("FIAMaps/eng");
  });

  it("caches catalog in R2 on first call", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("metadata.json")) {
        return {
          resource_metadata: FIA_MAPS_ENTRY,
          scripture_burrito: { ingredients: { "json/001.content.json": {} } },
          article_metadata: {},
        } as ResourceMetadata;
      }
      if (url.includes("001.content.json")) return [MAP_ARTICLE];
      return null;
    });

    await handleBrowse({ resource_code: "FIAMaps" }, env, storage);

    // Second call should use cache — reset fetchJson to return null
    mockFetchJson.mockResolvedValue(null);
    const result = await handleBrowse({ resource_code: "FIAMaps" }, env, storage);
    expect(result.content[0]!.text).toContain("Abram's Journey");
  });

  it("handles empty content files gracefully", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("metadata.json")) {
        return {
          resource_metadata: FIA_MAPS_ENTRY,
          scripture_burrito: { ingredients: { "json/001.content.json": {} } },
          article_metadata: {},
        } as ResourceMetadata;
      }
      return null; // content file fetch fails
    });

    const result = await handleBrowse({ resource_code: "FIAMaps" }, env, storage);
    expect(result.content[0]!.text).toContain("No articles found");
  });

  it("clamps page_size to 1-100", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("metadata.json")) {
        return {
          resource_metadata: FIA_MAPS_ENTRY,
          scripture_burrito: { ingredients: { "json/001.content.json": {} } },
          article_metadata: {},
        } as ResourceMetadata;
      }
      if (url.includes("001.content.json")) return [MAP_ARTICLE];
      return null;
    });

    // page_size=0 → clamped to 1
    const result = await handleBrowse({ resource_code: "FIAMaps", page_size: 0 }, env, storage);
    expect(result.content[0]!.text).toContain("page 1/1");

    // page_size=999 → clamped to 100
    const result2 = await handleBrowse({ resource_code: "FIAMaps", page_size: 999 }, env, storage);
    expect(result2.content[0]!.text).toContain("page 1/1");
  });
});

describe("handleReadme", () => {
  let env: Env;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_CONTENT: {} as R2Bucket, AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs", WORKER_ENV: "production" };
  });

  it("fetches README and caches it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => "# Aquifer MCP\n\nREADME body",
    } as Response);

    const result = await handleReadme({}, env);
    expect(result.content[0]!.text).toContain("# Aquifer MCP");
    expect(result.content[0]!.text).toContain("README body");
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("returns cached README when refresh is false", async () => {
    await env.AQUIFER_CACHE.put("readme:v1:main", "# Cached README");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await handleReadme({}, env);
    expect(result.content[0]!.text).toContain("# Cached README");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("falls back to cached README if fetch fails", async () => {
    await env.AQUIFER_CACHE.put("readme:v1:main", "# Cached README");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));

    const result = await handleReadme({ refresh: true }, env);
    expect(result.content[0]!.text).toContain("# Cached README");
    fetchSpy.mockRestore();
  });
});

describe("handleTelemetryPolicy", () => {
  let env: Env;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_CONTENT: {} as R2Bucket, AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs", WORKER_ENV: "production" };
  });

  it("returns base policy with no surface", async () => {
    const result = await handleTelemetryPolicy({}, env);
    const text = result.content[0]!.text;
    expect(text).toContain("Aquifer Telemetry Policy (v1)");
    expect(text).toContain("No raw prompts");
    expect(text).toContain("Do not add obfuscation outside safety requirements");
  });

  it("returns targeted guidance for mcp-client", async () => {
    const result = await handleTelemetryPolicy({ surface: "mcp-client" }, env);
    const text = result.content[0]!.text;
    expect(text).toContain("Surface Guidance: mcp-client");
    expect(text).toContain("Exclude: tool arguments");
  });

  it("returns unknown-surface message with supported values", async () => {
    const result = await handleTelemetryPolicy({ surface: "unknown-surface" }, env);
    const text = result.content[0]!.text;
    expect(text).toContain('Unknown surface "unknown-surface"');
    expect(text).toContain("mcp-client");
    expect(text).toContain("aquifer-window");
  });
});

describe("handleTelemetryPublic", () => {
  let env: Env;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_CONTENT: {} as R2Bucket, AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs", WORKER_ENV: "production" };
  });

  it("returns empty leaderboard state when no telemetry exists", async () => {
    const result = await handleTelemetryPublic({}, env);
    const text = result.content[0]!.text;
    expect(text).toContain("Public Telemetry Snapshot");
    expect(text).toContain("MCP requests: 0");
    expect(text).toContain("No consumer calls recorded yet");
  });

  it("returns ranked consumers and tools from telemetry counters", async () => {
    await env.AQUIFER_CACHE.put("telemetry:v1:production:mcp_requests", "17");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:tool_calls", "12");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:consumer:Cursor", "8");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:consumer:AquiferWindow", "4");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:consumer-weighted:Cursor", "80");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:consumer-weighted:AquiferWindow", "4");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:consumer-verification:verified", "8");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:consumer-verification:unverified", "4");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:consumer-self-report-points:Cursor", "64");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:consumer-self-report-max:Cursor", "64");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:self-report-field:client_name", "12");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:self-report-field:surface", "9");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:tool:search", "7");
    await env.AQUIFER_CACHE.put("telemetry:v1:production:tool:get", "5");

    const result = await handleTelemetryPublic({ limit: 5 }, env);
    const text = result.content[0]!.text;
    expect(text).toContain("MCP requests: 17");
    expect(text).toContain("1. Cursor — 8 calls");
    expect(text).toContain("2. AquiferWindow — 4 calls");
    expect(text).toContain("1. search — 7 calls");
    expect(text).toContain("2. get — 5 calls");
    expect(text).toContain("1. Cursor — 80 weighted points");
    expect(text).toContain("1. verified — 8 calls");
    expect(text).toContain("Transparency Leaderboard");
    expect(text).toContain("1. Cursor — 100% (64/64) | Open Ledger");
    expect(text).toContain("Self-Report Field Counts");
    expect(text).toContain("Excluded Fields");
  });
});

describe("handleScripture", () => {
  let env: Env;
  let storage: AquiferStorage;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_CONTENT: {} as R2Bucket, AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs", WORKER_ENV: "production" };
    storage = createMockStorage();
    mockGetOrBuildIndex.mockResolvedValue(buildMockIndex([STUDY_NOTES_ENTRY, BIBLE_ENTRY]));
  });

  it("requires a reference", async () => {
    const result = await handleScripture({}, env, storage);
    expect(result.content[0]!.text).toContain("Please provide a Bible reference");
  });

  it("returns error for unparseable reference", async () => {
    const result = await handleScripture({ reference: "not a reference!!" }, env, storage);
    expect(result.content[0]!.text).toContain("Could not parse");
  });

  it("fetches Bible text for a valid reference", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("45.content.json")) return [BIBLE_ARTICLE];
      return null;
    });

    const result = await handleScripture({ reference: "Romans 3:23" }, env, storage);
    const text = result.content[0]!.text;
    expect(text).toContain("Scripture:");
    expect(text).toContain("Biblica Bible");
    expect(text).toContain("all have sinned");
  });

  it("parses abbreviation 'Rom 3:23'", async () => {
    mockFetchJson.mockImplementation(async (url: string) => {
      if (url.includes("45.content.json")) return [BIBLE_ARTICLE];
      return null;
    });

    const result = await handleScripture({ reference: "Rom 3:23" }, env, storage);
    expect(result.content[0]!.text).toContain("all have sinned");
  });

  it("returns no-text message when no Bible articles match", async () => {
    mockFetchJson.mockResolvedValue(null);
    const result = await handleScripture({ reference: "Rev 22:21" }, env, storage);
    expect(result.content[0]!.text).toContain("No Bible text found");
  });

  it("filters by resource_code when specified", async () => {
    mockFetchJson.mockResolvedValue(null);
    const result = await handleScripture({ reference: "Rom 3:23", resource_code: "NonExistentBible" }, env, storage);
    expect(result.content[0]!.text).toContain("not found");
  });
});

describe("handleEntity", () => {
  let env: Env;
  let storage: AquiferStorage;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_CONTENT: {} as R2Bucket, AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs", WORKER_ENV: "production" };
    storage = createMockStorage();
    mockGetOrBuildIndex.mockResolvedValue(buildMockIndex([STUDY_NOTES_ENTRY, FIA_MAPS_ENTRY]));
    mockFetchJson.mockResolvedValue(null);
  });

  it("requires an entity_id", async () => {
    const result = await handleEntity({}, env, storage);
    expect(result.content[0]!.text).toContain("Please provide an entity ID");
  });

  it("returns grouped results for known entity", async () => {
    const result = await handleEntity({ entity_id: "person:Paul" }, env, storage);
    const text = result.content[0]!.text;
    expect(text).toContain("Entity Profile: person:Paul");
    expect(text).toContain("Romans 1:1–17");
    expect(text).toContain("Use `get`");
  });

  it("returns not-found for unknown entity", async () => {
    const result = await handleEntity({ entity_id: "person:UnknownEntity" }, env, storage);
    expect(result.content[0]!.text).toContain("No articles found");
  });
});

describe("handleList capabilities", () => {
  let env: Env;
  let storage: AquiferStorage;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_CONTENT: {} as R2Bucket, AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs", WORKER_ENV: "production" };
    storage = createMockStorage();
    mockGetOrBuildIndex.mockResolvedValue(buildMockIndex([STUDY_NOTES_ENTRY, BIBLE_ENTRY]));
  });

  it("shows scripture in capabilities for Bible resources", async () => {
    const result = await handleList({ type: "Bible" }, env, storage);
    const text = result.content[0]!.text;
    expect(text).toContain("Tools: scripture, search, get, related, browse");
  });

  it("does not show scripture for non-Bible resources", async () => {
    const result = await handleList({ type: "StudyNotes" }, env, storage);
    const text = result.content[0]!.text;
    expect(text).toContain("Tools: search, get, related, browse");
    expect(text).not.toContain("scripture");
  });
});
