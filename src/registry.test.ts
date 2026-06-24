import { describe, it, expect } from "vitest";
import { resolveResourceLanguage } from "./registry.js";

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
