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
    expect(parseReference("market")).toBeNull();
    expect(parseReference("hello")).toBeNull();
  });

  it("parses case-insensitively", () => {
    expect(parseReference("rom 3:24")).toBe("45003024");
    expect(parseReference("romans 3:24")).toBe("45003024");
  });

  it("parses USFM chapter only (MRK 4)", () => {
    expect(parseReference("MRK 4")).toBe("41004001-41004999");
  });

  it("parses name chapter only (Mark 4)", () => {
    expect(parseReference("Mark 4")).toBe("41004001-41004999");
  });

  it("parses chapter only case-insensitively", () => {
    expect(parseReference("mark 4")).toBe("41004001-41004999");
    expect(parseReference("mrk 4")).toBe("41004001-41004999");
  });

  it("parses USFM chapter range (MRK 4-6)", () => {
    expect(parseReference("MRK 4-6")).toBe("41004001-41006999");
  });

  it("parses name chapter range (Mark 4-6)", () => {
    expect(parseReference("Mark 4-6")).toBe("41004001-41006999");
  });

  it("parses chapter range with en-dash", () => {
    expect(parseReference("Mark 4\u20136")).toBe("41004001-41006999");
  });

  it("parses USFM book only (MRK)", () => {
    expect(parseReference("MRK")).toBe("41001001-41999999");
  });

  it("parses name book only (Mark)", () => {
    expect(parseReference("Mark")).toBe("41001001-41999999");
  });

  it("parses book only case-insensitively", () => {
    expect(parseReference("mark")).toBe("41001001-41999999");
    expect(parseReference("mrk")).toBe("41001001-41999999");
  });

  it("parses numbered book names (1 Corinthians 13)", () => {
    expect(parseReference("1 Corinthians 13")).toBe("46013001-46013999");
  });

  it("parses numbered USFM book only (1CO)", () => {
    expect(parseReference("1CO")).toBe("46001001-46999999");
  });

  it("parses Psalm 119 (chapter only)", () => {
    expect(parseReference("Psalm 119")).toBe("19119001-19119999");
  });

  it("parses Romans 1-3 (chapter range)", () => {
    expect(parseReference("Romans 1-3")).toBe("45001001-45003999");
  });

  it("parses Jude (single-chapter book, book only)", () => {
    expect(parseReference("Jude")).toBe("65001001-65999999");
  });

  it("parses 3 John (numbered book only)", () => {
    expect(parseReference("3 John")).toBe("64001001-64999999");
  });

  it("parses Revelation book only", () => {
    expect(parseReference("Revelation")).toBe("66001001-66999999");
  });

  it("parses Genesis 1 (chapter only)", () => {
    expect(parseReference("Genesis 1")).toBe("01001001-01001999");
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

  it("formats book-only sentinel range", () => {
    expect(rangeToReadable("41001001-41999999")).toBe("MRK");
  });

  it("formats chapter-only sentinel range", () => {
    expect(rangeToReadable("41004001-41004999")).toBe("MRK 4");
  });

  it("formats chapter-range sentinel range", () => {
    expect(rangeToReadable("41004001-41006999")).toBe("MRK 4-6");
  });

  it("formats Psalms book-only sentinel", () => {
    expect(rangeToReadable("19001001-19999999")).toBe("PSA");
  });

  it("formats Psalm 119 chapter sentinel", () => {
    expect(rangeToReadable("19119001-19119999")).toBe("PSA 119");
  });
});

describe("rangesOverlap with sentinel ranges", () => {
  it("chapter sentinel overlaps verse in same chapter", () => {
    expect(rangesOverlap("41004001-41004999", "41004020-41004020")).toBe(true);
  });

  it("chapter sentinel does not overlap next chapter", () => {
    expect(rangesOverlap("41004001-41004999", "41005001-41005001")).toBe(false);
  });

  it("book sentinel overlaps any verse in the book", () => {
    expect(rangesOverlap("41001001-41999999", "41016020-41016020")).toBe(true);
  });

  it("book sentinel does not overlap next book", () => {
    expect(rangesOverlap("41001001-41999999", "42001001-42001001")).toBe(false);
  });

  it("chapter range sentinel overlaps verse within range", () => {
    expect(rangesOverlap("41004001-41006999", "41005010-41005010")).toBe(true);
  });

  it("chapter range sentinel does not overlap outside range", () => {
    expect(rangesOverlap("41004001-41006999", "41007001-41007001")).toBe(false);
  });
});
