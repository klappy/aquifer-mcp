import { describe, it, expect } from "vitest";
import { resolveResourceLanguage, computeCompositeHash } from "./registry.js";

describe("resolveResourceLanguage (manifest-driven)", () => {
  it("returns the declared non-English primary language for a fra-only resource", () => {
    expect(resolveResourceLanguage("AquiferFrenchBibleReferenceText")).toBe("fra");
  });

  it("returns eng for an English-primary resource", () => {
    expect(resolveResourceLanguage("BiblicaOpenBibleMaps")).toBe("eng");
    expect(resolveResourceLanguage("BDBHebrewLexicon")).toBe("eng");
  });

  it("falls back to eng for a repo not present in the manifest", () => {
    expect(resolveResourceLanguage("SomeRepoNotInManifest")).toBe("eng");
  });
});

describe("computeCompositeHash (schema-token / version-aware)", () => {
  const shas = new Map([
    ["RepoA", "aaaaaaa"],
    ["RepoB", "bbbbbbb"],
  ]);

  it("is deterministic for the same SHAs and token", async () => {
    expect(await computeCompositeHash(shas, "v1.6.1")).toBe(await computeCompositeHash(shas, "v1.6.1"));
  });

  it("changes when the schema token (app version) changes — forces rebuild on deploy", async () => {
    const a = await computeCompositeHash(shas, "v1.6.0");
    const b = await computeCompositeHash(shas, "v1.6.1");
    expect(a).not.toBe(b);
  });

  it("still changes when repo SHAs change (existing content-addressing preserved)", async () => {
    const other = new Map([
      ["RepoA", "aaaaaaa"],
      ["RepoB", "ccccccc"],
    ]);
    expect(await computeCompositeHash(shas, "v1.6.1")).not.toBe(await computeCompositeHash(other, "v1.6.1"));
  });

  it("is order-independent over the SHA map", async () => {
    const reordered = new Map([
      ["RepoB", "bbbbbbb"],
      ["RepoA", "aaaaaaa"],
    ]);
    expect(await computeCompositeHash(shas, "v1.6.1")).toBe(await computeCompositeHash(reordered, "v1.6.1"));
  });
});
