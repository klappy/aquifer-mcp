import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleList, handleSearch, handleGet, handleRelated, handleBrowse } from "./tools.js";
import type { Env, NavigabilityIndex, ResourceEntry, ArticleRef, ArticleContent, ResourceMetadata } from "./types.js";

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
    list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
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
  return {
    registry: entries,
    passage: new Map(passageEntries ?? [["45001001-45001017", [ROMANS_ARTICLE_REF]]]),
    entity: new Map([["person:paul", [ROMANS_ARTICLE_REF]]]),
    title: [
      ROMANS_ARTICLE_REF,
      { resource_code: "FIAMaps", language: "eng", content_id: "368172", title: "Abram's Journey from Ur to Canaan", resource_type: "Images, Maps, Videos" },
    ],
    built_at: Date.now(),
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
}));

import { getOrBuildIndex } from "./registry.js";
import { fetchJson } from "./github.js";

const mockGetOrBuildIndex = vi.mocked(getOrBuildIndex);
const mockFetchJson = vi.mocked(fetchJson);

// --- Tests ---

describe("handleList", () => {
  let env: Env;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs" };
    mockGetOrBuildIndex.mockResolvedValue(buildMockIndex([STUDY_NOTES_ENTRY, FIA_MAPS_ENTRY]));
  });

  it("returns all resources when no filters", async () => {
    const result = await handleList({}, env);
    expect(result.content[0]!.text).toContain("Found 2 resource(s)");
    expect(result.content[0]!.text).toContain("Biblica Study Notes");
    expect(result.content[0]!.text).toContain("FIAMaps");
  });

  it("filters by type", async () => {
    const result = await handleList({ type: "Images" }, env);
    expect(result.content[0]!.text).toContain("Found 1 resource(s)");
    expect(result.content[0]!.text).toContain("FIAMaps");
    expect(result.content[0]!.text).not.toContain("Biblica Study Notes");
  });

  it("filters by language", async () => {
    const result = await handleList({ language: "spa" }, env);
    expect(result.content[0]!.text).toContain("Found 1 resource(s)");
    expect(result.content[0]!.text).toContain("Biblica Study Notes");
  });

  it("returns message when no match", async () => {
    const result = await handleList({ type: "NonExistent" }, env);
    expect(result.content[0]!.text).toContain("No resources found");
  });
});

describe("handleSearch", () => {
  let env: Env;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs" };
    mockGetOrBuildIndex.mockResolvedValue(buildMockIndex([STUDY_NOTES_ENTRY, FIA_MAPS_ENTRY]));
    mockFetchJson.mockResolvedValue(null);
  });

  it("requires a query", async () => {
    const result = await handleSearch({}, env);
    expect(result.content[0]!.text).toContain("Please provide a search query");
  });

  it("searches by passage reference", async () => {
    const result = await handleSearch({ query: "ROM 1:1" }, env);
    expect(result.content[0]!.text).toContain("Romans 1:1–17");
  });

  it("searches by human-readable reference", async () => {
    const result = await handleSearch({ query: "Romans 1:5" }, env);
    expect(result.content[0]!.text).toContain("Romans 1:1–17");
  });

  it("returns no results for uncovered passage", async () => {
    const result = await handleSearch({ query: "REV 22:21" }, env);
    expect(result.content[0]!.text).toContain("No articles found for passage");
  });

  it("searches by keyword", async () => {
    const result = await handleSearch({ query: "Abram" }, env);
    expect(result.content[0]!.text).toContain("Abram's Journey");
  });

  it("returns no results for unmatched keyword", async () => {
    const result = await handleSearch({ query: "xyznonexistent" }, env);
    expect(result.content[0]!.text).toContain("No articles found matching");
  });
});

describe("handleGet", () => {
  let env: Env;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs" };
    mockGetOrBuildIndex.mockResolvedValue(buildMockIndex([STUDY_NOTES_ENTRY]));
  });

  it("requires all three fields", async () => {
    const result = await handleGet({ resource_code: "BiblicaStudyNotes" }, env);
    expect(result.content[0]!.text).toContain("Missing required fields");
  });

  it("returns error for unknown resource", async () => {
    const result = await handleGet({ resource_code: "NonExistent", language: "eng", content_id: "123" }, env);
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

    const result = await handleGet({ resource_code: "BiblicaStudyNotes", language: "eng", content_id: "132828" }, env);
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

    const result = await handleGet({ resource_code: "BiblicaStudyNotes", language: "eng", content_id: "999999" }, env);
    expect(result.content[0]!.text).toContain("not found");
  });
});

describe("handleRelated", () => {
  let env: Env;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs" };
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
    const result = await handleRelated({ resource_code: "BiblicaStudyNotes" }, env);
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
    );
    const text = result.content[0]!.text;
    expect(text).toContain("Passage overlap");
    expect(text).toContain("Romans 1:1-17 (Open)");
  });
});

describe("handleBrowse", () => {
  let env: Env;

  beforeEach(() => {
    env = { AQUIFER_CACHE: createMockKV(), AQUIFER_ORG: "BibleAquifer", DOCS_REPO: "docs" };
    mockGetOrBuildIndex.mockResolvedValue(buildMockIndex([STUDY_NOTES_ENTRY, FIA_MAPS_ENTRY]));
  });

  it("requires resource_code", async () => {
    const result = await handleBrowse({}, env);
    expect(result.content[0]!.text).toContain("Missing required field: resource_code");
  });

  it("returns error for unknown resource", async () => {
    const result = await handleBrowse({ resource_code: "NonExistent" }, env);
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

    const result = await handleBrowse({ resource_code: "FIAMaps" }, env);
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
    const page1 = await handleBrowse({ resource_code: "FIAMaps", page_size: 1 }, env);
    expect(page1.content[0]!.text).toContain("page 1/2");
    expect(page1.content[0]!.text).toContain("Abram's Journey");
    expect(page1.content[0]!.text).toContain("Use page=2 to see more");

    const page2 = await handleBrowse({ resource_code: "FIAMaps", page_size: 1, page: 2 }, env);
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

    const result = await handleBrowse({ resource_code: "FIAMaps", page: 99 }, env);
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

    const result = await handleBrowse({ resource_code: "FIAMaps" }, env);
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

    const result = await handleBrowse({ resource_code: "FIAMaps" }, env);
    expect(result.content[0]!.text).toContain("FIAMaps/eng");
  });

  it("caches catalog in KV on first call", async () => {
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

    await handleBrowse({ resource_code: "FIAMaps" }, env);

    // Second call should use cache — reset fetchJson to return null
    mockFetchJson.mockResolvedValue(null);
    const result = await handleBrowse({ resource_code: "FIAMaps" }, env);
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

    const result = await handleBrowse({ resource_code: "FIAMaps" }, env);
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
    const result = await handleBrowse({ resource_code: "FIAMaps", page_size: 0 }, env);
    expect(result.content[0]!.text).toContain("page 1/1");

    // page_size=999 → clamped to 100
    const result2 = await handleBrowse({ resource_code: "FIAMaps", page_size: 999 }, env);
    expect(result2.content[0]!.text).toContain("page 1/1");
  });
});
