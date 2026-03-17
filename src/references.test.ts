import { describe, it, expect } from "vitest";
import {
  parseReference,
  isValidIndexReference,
  rangesOverlap,
  bbcccvvvToReadable,
  rangeToReadable,
} from "./references.js";

describe("parseReference", () => {
  it("parses raw BBCCCVVV", () => {
    expect(parseReference("45003024")).toBe("45003024");
  });

  it("parses BBCCCVVV range", () => {
    expect(parseReference("45003021-45003031")).toBe("45003021-45003031");
  });

  it("parses USFM format (ROM 3:24)", () => {
    expect(parseReference("ROM 3:24")).toBe("45003024");
  });

  it("parses USFM range (ROM 3:24-26)", () => {
    expect(parseReference("ROM 3:24-26")).toBe("45003024-45003026");
  });

  it("parses human-readable (Romans 3:24)", () => {
    expect(parseReference("Romans 3:24")).toBe("45003024");
  });

  it("parses Genesis 1:1", () => {
    expect(parseReference("GEN 1:1")).toBe("01001001");
  });

  it("parses 1 Corinthians reference", () => {
    expect(parseReference("1CO 13:1")).toBe("46013001");
  });

  it("returns null for non-reference strings", () => {
    expect(parseReference("hello world")).toBeNull();
    expect(parseReference("keyterm:Justification")).toBeNull();
    expect(parseReference("")).toBeNull();
  });

  it("parses case-insensitively", () => {
    expect(parseReference("rom 3:24")).toBe("45003024");
    expect(parseReference("romans 3:24")).toBe("45003024");
  });
});

describe("isValidIndexReference", () => {
  it("accepts valid BBCCCVVV", () => {
    expect(isValidIndexReference("45003024")).toBe(true);
  });

  it("accepts valid BBCCCVVV range", () => {
    expect(isValidIndexReference("45003021-45003031")).toBe(true);
  });

  it("rejects title strings", () => {
    expect(isValidIndexReference("abram's journey from ur to canaan")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidIndexReference("")).toBe(false);
  });

  it("rejects short strings", () => {
    expect(isValidIndexReference("4500302")).toBe(false);
  });
});

describe("rangesOverlap", () => {
  it("detects single verse within range", () => {
    expect(rangesOverlap("45003024", "45003021-45003031")).toBe(true);
  });

  it("detects overlapping ranges", () => {
    expect(rangesOverlap("45003020-45003025", "45003021-45003031")).toBe(true);
  });

  it("detects exact match", () => {
    expect(rangesOverlap("45003024", "45003024")).toBe(true);
  });

  it("rejects non-overlapping ranges", () => {
    expect(rangesOverlap("45003001-45003010", "45003021-45003031")).toBe(false);
  });

  it("rejects different books", () => {
    expect(rangesOverlap("01001001", "45003024")).toBe(false);
  });
});

describe("bbcccvvvToReadable", () => {
  it("converts to USFM-style readable", () => {
    expect(bbcccvvvToReadable("45003024")).toBe("ROM 3:24");
  });

  it("converts Genesis", () => {
    expect(bbcccvvvToReadable("01001001")).toBe("GEN 1:1");
  });

  it("converts Revelation", () => {
    expect(bbcccvvvToReadable("66022021")).toBe("REV 22:21");
  });
});

describe("rangeToReadable", () => {
  it("formats single reference", () => {
    expect(rangeToReadable("45003024")).toBe("ROM 3:24");
  });

  it("formats same-chapter range", () => {
    expect(rangeToReadable("45003021-45003031")).toBe("ROM 3:21-31");
  });

  it("formats cross-chapter range", () => {
    expect(rangeToReadable("45001001-45002029")).toBe("ROM 1:1-2:29");
  });
});
